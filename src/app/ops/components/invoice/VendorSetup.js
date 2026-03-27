"use client";
import { useState, useRef, useEffect, useCallback } from "react";

/* ── SVG Icons ────────────────────────────────────── */
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const ArrowRight = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);
const ArrowLeft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/* ── Time formatter ──────────────────────────────── */
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

/* ── Step config ──────────────────────────────────── */
const STEPS = [
  { key: "basics",   label: "Basics",          short: "1" },
  { key: "portal",   label: "Portal & Ordering", short: "2" },
  { key: "rep",      label: "Sales Rep",        short: "3" },
  { key: "review",   label: "Review",           short: "4" },  // ← was "Notes & Review"
];

const CATEGORIES = [
  "Produce", "Protein", "Dairy", "Dry Goods", "Beverage",
  "Packaging", "Cleaning", "Equipment", "Specialty", "Broadliner", "Other",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DELIVERY_METHODS = ["Direct Delivery", "Will Call / Pickup", "Shipped (Common Carrier)", "Drop Ship"];

const PAYMENT_TERMS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "COD", "Prepaid", "Credit Card", "I don't know"];

/* ── Default form state ───────────────────────────── */
const emptyForm = () => ({
  // Step 1 — Basics
  vendorName: "",
  category: "",
  categoryOther: "",
  existingVendorId: null,
  // Step 2 — Portal & Ordering
  website: "",
  portalUrl: "",
  portalUsername: "",
  portalPassword: "",
  deliveryDays: [],
  cutoffTime: "",
  deliveryMethod: "",
  minOrder: "",
  paymentTerms: "",
  customerAccountNum: "",
  // Step 3 — Sales Rep
  salesRepName: "",
  salesRepPhone: "",
  salesRepEmail: "",
  // Step 4 — Notes
  notes: "",
  accountNotes: "",  // site-specific → vendor_accounts col W
});

/* ═════════════════════════════════════════════════════
   VendorSetup — 4-Step Stepper
   ═════════════════════════════════════════════════════ */
export default function VendorSetup({ account, onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState("quick"); // "quick" | "full"
  const searchRef = useRef(null);
  const bodyRef = useRef(null);
  const didFocusSearch = useRef(false);
  const searchTimer = useRef(null);
  const nameCheckTimer = useRef(null);
  const [dupMatch, setDupMatch] = useState(null); // { vendorId, name, category } | null

  // Auto-focus search only on first mount
  useEffect(() => {
    if (step === 0 && searchRef.current && !didFocusSearch.current) {
      searchRef.current.focus();
      didFocusSearch.current = true;
    }
    if (step !== 0) didFocusSearch.current = false; // reset so re-entering step 0 focuses again
  }, [step]);

  // Scroll to top on step change
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [step]);

  /* ── Helpers ──────────────────────────────────── */
  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const toggleDay = (d) =>
    setForm((f) => ({
      ...f,
      deliveryDays: f.deliveryDays.includes(d)
        ? f.deliveryDays.filter((x) => x !== d)
        : [...f.deliveryDays, d],
    }));

  const selectExistingVendor = (v) => {
    setForm((f) => ({
      ...f,
      existingVendorId: v.vendorId,
      vendorName: v.name,
      category: v.category || f.category,
      website: v.website || f.website,
    }));
    setSearch("");
    setMode("full"); // always full setup when linking existing vendor — quick mode silently drops all fields
    setStep(1); // jump to step 2
  };

  const clearVendor = () => {
    setForm((f) => ({ ...f, existingVendorId: null, vendorName: "", category: "" }));
    setStep(0);
  };

  /* ── Validation per step ─────────────────────── */
  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!form.vendorName.trim()) e.vendorName = true;
    }
    if (s === 1) {
      if (!form.deliveryMethod) e.deliveryMethod = true;
    }
    // Steps 2 & 3 — no required fields
    setErrors(e);
    return Object.keys(e).length === 0;
  };

const goNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, 3));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));
  const skipToReview = () => setStep(3);

  // Quick Add — submits with just name + category, skips all other steps
const handleQuickSubmit = async () => {
    const e = {};
    if (!form.vendorName.trim()) e.vendorName = true;
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (saving) return;
    setSaving(true);
    try {
const payload = {
        action: "vendor-add",
        account,
        vendorName: form.vendorName.trim(),
        category: form.category === "Other"
          ? (form.categoryOther?.trim() || "Other")
          : form.category,
        deliveryMethod: "",
        existingVendorId: form.existingVendorId || undefined,
      };
                        const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        onCreated({
          vendorId: data.vendorId,
          name: form.vendorName.trim(),
          category: form.category,
        });
      } else {
        alert(data.error || "Failed to save vendor");
      }
    } catch (err) {
      console.error("VendorSetup quick submit error:", err);
      alert("Network error — try again");
    } finally {
      setSaving(false);
    }
  };
  
  /* ── Submit ──────────────────────────────────── */
  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
const payload = {
        action: "vendor-add",
        account,
        vendorName: form.vendorName.trim(),
        category: form.category === "Other"
          ? (form.categoryOther?.trim() || "Other")
          : form.category,
        website: form.website.trim(),
                notes: form.notes.trim(),
        accountNotes: form.accountNotes.trim(),
        customerAccountNum: form.customerAccountNum.trim(),
        salesRepName: form.salesRepName.trim(),
        salesRepPhone: form.salesRepPhone.trim(),
        salesRepEmail: form.salesRepEmail.trim(),
        deliveryDays: form.deliveryDays.join(", "),
        cutoffTime: form.cutoffTime.trim(),
        deliveryMethod: form.deliveryMethod,
        portalUrl: form.portalUrl.trim() || form.website.trim(),
        portalUsername: form.portalUsername.trim(),
        portalPassword: form.portalPassword,
        paymentTerms: form.paymentTerms,
        minOrder: form.minOrder,
        existingVendorId: form.existingVendorId || undefined,
      };

      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        onCreated({
          vendorId: data.vendorId,
          name: form.vendorName.trim(),
          category: form.category,
          deliveryDays: form.deliveryDays.join(", "),
          deliveryMethod: form.deliveryMethod,
          paymentTerms: form.paymentTerms,
          salesRepName: form.salesRepName.trim(),
          portalUrl: form.portalUrl.trim() || form.website.trim(),
        });
      } else {
        alert(data.error || "Failed to save vendor");
      }
    } catch (err) {
      console.error("VendorSetup submit error:", err);
      alert("Network error — try again");
    } finally {
      setSaving(false);
    }
  };

  /* ── Duplicate name check — fires when typing in the "create new" name field ── */
  useEffect(() => {
    const name = form.vendorName.trim();
    if (!name || form.existingVendorId) { setDupMatch(null); return; }
    clearTimeout(nameCheckTimer.current);
    nameCheckTimer.current = setTimeout(() => {
      fetch(`/api/ops?action=vendor-search&q=${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(d => {
          const vendors = d.vendors || [];
          // Only flag if a result is a close match (name starts with or contains the typed value)
          const match = vendors.find(v =>
            v.name.toLowerCase() === name.toLowerCase() ||
            v.name.toLowerCase().startsWith(name.toLowerCase())
          );
          setDupMatch(match || null);
        })
        .catch(() => setDupMatch(null));
    }, 400);
    return () => clearTimeout(nameCheckTimer.current);
  }, [form.vendorName, form.existingVendorId]);

  /* ── Live vendor search (debounced, hits vendor-search API) ── */
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/ops?action=vendor-search&q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => setSearchResults(d.vendors || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  /* ── Step indicator component ────────────────── */
  const StepBar = () => (
    <div className="oh-inv-vs-stepper">
      {STEPS.map((s, i) => (
        <div key={s.key} className={`oh-inv-vs-step ${i < step ? "oh-inv-vs-step--done" : ""} ${i === step ? "oh-inv-vs-step--active" : ""}`}>
          <div className="oh-inv-vs-step-dot">
            {i < step ? <CheckIcon /> : <span>{i + 1}</span>}
          </div>
          <span className="oh-inv-vs-step-label">{s.label}</span>
          {i < STEPS.length - 1 && <div className="oh-inv-vs-step-line" />}
        </div>
      ))}
    </div>
  );

  /* ── Input helper (render fn, NOT a component — avoids remount/focus loss) ── */
  const renderField = (label, name, { type = "text", required, placeholder, fullWidth, children } = {}) => (
    <div className={`oh-inv-vs-field ${fullWidth ? "oh-inv-vs-field--full" : ""} ${errors[name] ? "oh-inv-vs-field--error" : ""}`}>
      <label>
        {label}
        {required && <span className="oh-inv-vs-req">*</span>}
      </label>
      {children || (
        <input
          type={type}
          value={form[name] || ""}
          onChange={(e) => { set(name, e.target.value); if (errors[name]) setErrors((p) => ({ ...p, [name]: false })); }}
          placeholder={placeholder || ""}
          autoComplete="off"
        />
      )}
    </div>
  );

  /* ═══════════════════════════════════════════════
     STEP RENDERERS
     ═══════════════════════════════════════════════ */

  /* ── Step 1: Basics ──────────────────────────── */
  const renderBasics = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
      {/* If vendor already selected, show selected card */}
      {form.existingVendorId ? (
        <div className="oh-inv-vs-selected">
          <div>
            <span className="oh-inv-vs-selected-name">{form.vendorName}</span>
            {form.category && <span className="oh-inv-vs-selected-cat">{form.category}</span>}
          </div>
          <button type="button" className="oh-inv-vs-change" onClick={clearVendor}>Change</button>
        </div>
      ) : (
        <>
          {/* Vendor search */}
          <div className="oh-inv-vs-search-wrap">
            <SearchIcon />
            <input
              ref={searchRef}
              type="text"
              className="oh-inv-vs-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search existing vendors…"
            />
          </div>

          {/* Search results */}
          {searchLoading && (
            <div className="oh-inv-vs-no-results" style={{ color: "#94a3b8" }}>Searching…</div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div className="oh-inv-vs-vendor-list">
              {searchResults.map((v) => (
                <button key={v.vendorId} type="button" className="oh-inv-vs-vendor-item" onClick={() => selectExistingVendor(v)}>
                  <span className="oh-inv-vs-vendor-name">{v.name}</span>
                  {v.category && <span className="oh-inv-vs-vendor-cat">{v.category}</span>}
                </button>
              ))}
            </div>
          )}

          {!searchLoading && search.trim().length >= 2 && searchResults.length === 0 && (
            <div className="oh-inv-vs-no-results">No vendors match "{search}"</div>
          )}

          {/* Divider */}
          <div className="oh-inv-vs-divider">
            <span>or create new vendor</span>
          </div>

          {/* New vendor fields */}
          <div className={`oh-inv-vs-field oh-inv-vs-field--full${errors.vendorName ? " oh-inv-vs-field--error" : ""}`}>
            <label>Vendor Name <span className="oh-inv-vs-req">*</span></label>
            <input
              type="text"
              value={form.vendorName}
              onChange={(e) => {
                set("vendorName", e.target.value);
                if (errors.vendorName) setErrors((p) => ({ ...p, vendorName: false }));
              }}
              placeholder="e.g. US Foods, Sysco"
              autoComplete="off"
            />
          </div>

          {/* Duplicate vendor warning banner */}
          {dupMatch && !form.existingVendorId && (
            <div className="oh-inv-vs-dup-banner">
              <div className="oh-inv-vs-dup-banner-text">
                <div className="oh-inv-vs-dup-name-row">
                  <strong>{dupMatch.name}</strong>
                  {dupMatch.category && <span className="oh-inv-vs-dup-cat">{dupMatch.category}</span>}
                </div>
                <span className="oh-inv-vs-dup-hint">Already exists globally — link it to this account instead of creating a duplicate.</span>
              </div>
              <button
                type="button"
                className="oh-inv-vs-dup-btn"
                onClick={() => selectExistingVendor(dupMatch)}
              >
                Link Vendor →
              </button>
            </div>
          )}
  {renderField("Category", "category", { children: (
            <select
              value={form.category}
              onChange={(e) => {
                set("category", e.target.value);
                set("categoryOther", ""); // clear any prior custom text
              }}
            >
              <option value="">Select category…</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )})}
          {form.category === "Other" && (
            <div className="oh-inv-vs-field oh-inv-vs-field--full" style={{ marginTop: 8 }}>
              <label>Specify category</label>
              <input
                type="text"
                placeholder="e.g. Linen, Pest Control, Uniforms…"
                value={form.categoryOther || ""}
                onChange={(e) => set("categoryOther", e.target.value)}
                autoFocus
              />
            </div>
          )}                  </>
      )}
    </div>
  );

  /* ── Step 2: Portal & Ordering ───────────────── */
  const renderPortal = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
      {/* Portal section */}
      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header">
          <GlobeIcon />
          <span>Online Portal</span>
        </div>
        <div className="oh-inv-vs-box-body">
          {renderField("Website", "website", { type: "url", placeholder: "https://www.usfoods.com", fullWidth: true })}
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Portal Username", "portalUsername", { placeholder: "login@kitchfix.com" })}
            {renderField("Portal Password", "portalPassword", { children: (
              <div className="oh-inv-vs-pw-wrap">
                <input
                  type={showPw ? "text" : "password"}
                  value={form.portalPassword}
                  onChange={(e) => set("portalPassword", e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
                <button type="button" className="oh-inv-vs-pw-toggle" onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            )})}
          </div>
        </div>
      </div>

      {/* Ordering section */}
      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header">
          <span>📦</span>
          <span>Ordering Details</span>
        </div>
        <div className="oh-inv-vs-box-body">
          <div className="oh-inv-vs-field oh-inv-vs-field--full">
            <label>Delivery Days</label>
            <div className="oh-inv-vs-day-chips">
              {DAYS.map((d) => (
                <button
                  key={d} type="button"
                  className={`oh-inv-vs-day-chip ${form.deliveryDays.includes(d) ? "oh-inv-vs-day-chip--active" : ""}`}
                  onClick={() => toggleDay(d)}
                >{d}</button>
              ))}
            </div>
          </div>

          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            <div className="oh-inv-vs-field">
              <label>Order Cutoff</label>
              <input
                type="text"
                value={form.cutoffTime}
                onChange={(e) => set("cutoffTime", e.target.value)}
                placeholder="e.g. 2:00 PM"
                autoComplete="off"
              />
            </div>
            {renderField("Delivery Method", "deliveryMethod", { required: true, children: (
              <select
                value={form.deliveryMethod}
                onChange={(e) => { set("deliveryMethod", e.target.value); if (errors.deliveryMethod) setErrors((p) => ({ ...p, deliveryMethod: false })); }}
                className={errors.deliveryMethod ? "oh-inv-vs-required" : ""}
              >
                <option value="">Select method…</option>
                {DELIVERY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )})}
          </div>
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Payment Terms", "paymentTerms", { children: (
              <select value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)}>
                <option value="">Select terms…</option>
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )})}
            {renderField("Min. Order", "minOrder", { children: (
              <div className="oh-inv-vs-dollar-wrap">
                <span className="oh-inv-vs-dollar-sign">$</span>
                <input
                  className="oh-inv-vs-dollar-input"
                  type="text"
                  value={form.minOrder}
                  onChange={(e) => set("minOrder", e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder=""  /* ← was "0.00" */
                />
              </div>
            )})}
          </div>
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Customer Account #", "customerAccountNum", { placeholder: "e.g. 1234567", fullWidth: true })}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Step 3: Sales Rep ───────────────────────── */
  const renderRep = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header">
          <span>👤</span>
          <span>Sales Representative</span>
        </div>
        <div className="oh-inv-vs-box-body">
          {renderField("Rep Name", "salesRepName", { placeholder: "e.g. John Smith", fullWidth: true })}
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Phone", "salesRepPhone", { type: "tel", placeholder: "(555) 123-4567" })}
            {renderField("Email", "salesRepEmail", { type: "email", placeholder: "john@vendor.com" })}
          </div>
        </div>
      </div>
      <p className="oh-inv-vs-hint">All sales rep fields are optional. You can add this later.</p>
    </div>
  );

  /* ── Step 4: Review ──────────────────────────── */
  const renderReview = () => {
    const sections = [
      {
        title: "Vendor",
        items: [
          { label: "Name", value: form.vendorName },
          { label: "Category", value: form.category },
          form.existingVendorId && { label: "Type", value: "Existing vendor (new account link)" },
        ].filter(Boolean),
      },
      {
        title: "Portal & Ordering",
        items: [
          { label: "Website", value: form.website },
          { label: "Portal Login", value: form.portalUsername ? `${form.portalUsername} / ••••` : "" },
          { label: "Delivery", value: form.deliveryDays.length ? form.deliveryDays.join(", ") : "" },
          { label: "Cutoff", value: formatTimeTo12h(form.cutoffTime) },
          { label: "Method", value: form.deliveryMethod },
          { label: "Terms", value: form.paymentTerms },
          { label: "Min Order", value: form.minOrder ? `$${form.minOrder}` : "" },
          { label: "Acct #", value: form.customerAccountNum },
        ].filter((i) => i.value),
      },
      {
        title: "Sales Rep",
        items: [
          { label: "Name", value: form.salesRepName },
          { label: "Phone", value: form.salesRepPhone },
          { label: "Email", value: form.salesRepEmail },
        ].filter((i) => i.value),
      },
    ];

    return (
      <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
        {/* Site Notes — account-specific, stored in vendor_accounts */}
        <div className="oh-inv-vs-field oh-inv-vs-field--full" style={{ marginBottom: 12 }}>
          <label>
            Site Notes
            <span style={{ fontWeight: 400, fontSize: "0.75rem", color: "#94a3b8", marginLeft: 6 }}>
              only visible for this account
            </span>
          </label>
          <textarea
            className="oh-inv-vs-textarea"
            value={form.accountNotes}
            onChange={(e) => set("accountNotes", e.target.value)}
            placeholder="e.g. Use back entrance, ask for Sarah, COD only at this location…"
            rows={3}
          />
        </div>

        {/* Global Notes — stored in vendor_master, visible to all accounts */}
        <div className="oh-inv-vs-field oh-inv-vs-field--full" style={{ marginBottom: 18 }}>
          <label>
            Global Notes
            <span style={{ fontWeight: 400, fontSize: "0.75rem", color: "#94a3b8", marginLeft: 6 }}>
              visible to all accounts
            </span>
          </label>
          <textarea
            className="oh-inv-vs-textarea"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Ordering tips, quality notes, contract reminders, seasonal availability…"
            rows={3}
          />
        </div>

        {/* Review card */}
        <div className="oh-inv-vs-review-card">
          <div className="oh-inv-vs-review-badge">Review Summary</div>
          {sections.map((sec) => (
            sec.items.length > 0 && (
              <div key={sec.title} className="oh-inv-vs-review-section">
                <div className="oh-inv-vs-review-title">{sec.title}</div>
                {sec.items.map((it) => (
                  <div key={it.label} className="oh-inv-vs-review-row">
                    <span className="oh-inv-vs-review-label">{it.label}</span>
                    <span className="oh-inv-vs-review-value">{it.value}</span>
                  </div>
                ))}
              </div>
            )
          ))}
          {sections.every((s) => s.items.length <= 1) && (
            <p className="oh-inv-vs-review-minimal">Minimal info provided — you can always edit this vendor later.</p>
          )}
        </div>
      </div>
    );
  };

  /* ── Render step body ────────────────────────── */
  const renderStep = () => {
    switch (step) {
      case 0: return renderBasics();
      case 1: return renderPortal();
      case 2: return renderRep();
      case 3: return renderReview();
      default: return null;
    }
  };

  /* ── Footer buttons per step ─────────────────── */
  const isLastStep = step === 3;
  const isFirstStep = step === 0;

return (
<div className="oh-inv-vs-overlay">
      <div className="oh-inv-vs-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="oh-inv-vs-header">
          <h2 className="oh-inv-vs-title">
            {form.existingVendorId ? "Link Vendor" : "Add Vendor"}
          </h2>
          <button type="button" className="oh-inv-vs-close" onClick={onClose}><CloseIcon /></button>
        </div>

        {/* Mode switcher — only show on step 0, and only when not in existing-vendor flow */}
        {step === 0 && !form.existingVendorId && (
          <div className="oh-inv-vs-mode-toggle">
            <button
              type="button"
              className={`oh-inv-vs-mode-btn${mode === "quick" ? " oh-inv-vs-mode-btn--active" : ""}`}
              onClick={() => setMode("quick")}
            >
              ⚡ Quick Add
            </button>
            <button
              type="button"
              className={`oh-inv-vs-mode-btn${mode === "full" ? " oh-inv-vs-mode-btn--active" : ""}`}
              onClick={() => setMode("full")}
            >
              ⚙️ Full Setup
            </button>
          </div>
        )}

        {/* Mode description */}
        {step === 0 && !form.existingVendorId && (
          <p className="oh-inv-vs-mode-desc">
            {mode === "quick"
              ? "Name and category only — get back to your invoice."
              : "Add portal login, delivery schedule, payment terms, and rep info."}
          </p>
        )}

        {/* Stepper — only show in full setup mode */}
        {mode === "full" && <StepBar />}

        {/* Body */}
        <div className="oh-inv-vs-body" ref={bodyRef}>
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="oh-inv-vs-footer">
          {/* Back button — full setup only, not on first step */}
          {mode === "full" && !isFirstStep && (
            <button type="button" className="oh-inv-vs-back-btn" onClick={goBack}>
              <ArrowLeft /> Back
            </button>
          )}

          {mode === "quick" ? (
            /* ── Quick Add footer: right-aligned button ── */
            <div className="oh-inv-vs-footer-right">
              <button
                type="button"
                className="oh-inv-vs-save-btn"
                onClick={handleQuickSubmit}
                disabled={saving}
              >
                {saving ? (
                  <span className="oh-inv-vs-spinner" />
                ) : (
                  <>
                    <span>{form.existingVendorId ? "Link Vendor" : "Add Vendor"}</span>
                    <CheckIcon />
                  </>
                )}
              </button>
            </div>
          ) : isLastStep ? (
            /* ── Full Setup: last step — save ── */
            <button
              type="button"
              className="oh-inv-vs-save-btn"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? (
                <span className="oh-inv-vs-spinner" />
              ) : (
                <>
                  <span>{form.existingVendorId ? "Link Vendor" : "Create Vendor"}</span>
                  <CheckIcon />
                </>
              )}
            </button>
          ) : (
            /* ── Full Setup: middle steps — continue + optional skip ── */
            <div className="oh-inv-vs-footer-right">
              {(step === 1 || step === 2) && (
                <button type="button" className="oh-inv-vs-skip-btn" onClick={skipToReview}>
                  Skip — add later
                </button>
              )}
              <button type="button" className="oh-inv-vs-save-btn" onClick={goNext}>
                <span>Continue</span>
                <ArrowRight />
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}