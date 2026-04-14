"use client";
import { useState, useRef, useEffect } from "react";

/* ── Icons ──────────────────────────────────────── */
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
const LinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

/* ── Constants ───────────────────────────────────── */
const STEPS = [
  { key: "basics",   label: "Vendor"           },
  { key: "ordering", label: "Ordering & Portal" },
  { key: "rep",      label: "Sales Rep"         },
  { key: "review",   label: "Review"            },
];

const CATEGORIES = [
  "Produce", "Protein", "Dairy", "Dry Goods", "Beverage",
  "Packaging", "Cleaning", "Supplies", "Equipment", "Linen",
  "Specialty", "Broadliner", "Other",
];

const CATEGORY_COLORS = {
  Produce: "#16a34a", Protein: "#dc2626", Dairy: "#2563eb",
  "Dry Goods": "#d97706", Beverage: "#7c3aed", Packaging: "#0891b2",
  Cleaning: "#0d9488", Supplies: "#ca8a04", Equipment: "#475569",
  Linen: "#9d174d", Specialty: "#db2777", Broadliner: "#9333ea",
  Other: "#64748b",
};

const DAYS            = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DELIVERY_METHODS = ["Direct Delivery", "Will Call / Pickup", "Shipped (Common Carrier)", "Drop Ship"];
const PAYMENT_TERMS   = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "COD", "Prepaid", "Credit Card", "I don't know"];

const emptyForm = () => ({
  vendorName:         "",
  category:           "",   // single string — not array
  existingVendorId:   null,
  website:            "",
  portalUrl:          "",
  portalUsername:     "",
  portalPassword:     "",
  deliveryDays:       [],
  cutoffTime:         "",
  deliveryMethod:     "",
  minOrder:           "",
  paymentTerms:       "",
  customerAccountNum: "",
  salesRepName:       "",
  salesRepPhone:      "",
  salesRepEmail:      "",
  notes:              "",
  accountNotes:       "",
});

/* ═══════════════════════════════════════════════════
   VendorSetup — Full Setup Only, 4-Step Stepper
   ═══════════════════════════════════════════════════ */
export default function VendorSetup({ account, onClose, onCreated }) {
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState(emptyForm());
  const [saving, setSaving]   = useState(false);
  const [errors, setErrors]   = useState({});
  const [showPw, setShowPw]   = useState(false);

  // Search-as-you-type state (drives both results + duplicate check)
  const [searchResults, setSearchResults]   = useState([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [dupMatch, setDupMatch]             = useState(null);   // { vendorId, name, category, exactMatch }
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);

  const nameInputRef   = useRef(null);
  const bodyRef        = useRef(null);
  const searchTimer    = useRef(null);

  // Auto-focus name on mount
  useEffect(() => { nameInputRef.current?.focus(); }, []);

  // Scroll body to top on step change
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [step]);

  // Single typeahead: vendor name drives both search results AND duplicate detection
  useEffect(() => {
    const name = form.vendorName.trim();
    if (!name || form.existingVendorId) {
      setSearchResults([]);
      setDupMatch(null);
      setConfirmedDifferent(false);
      return;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/ops?action=vendor-search&q=${encodeURIComponent(name)}`)
        .then(r => r.json())
        .then(d => {
          const vendors = d.vendors || [];

          // Normalize for fuzzy comparison
          const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const qNorm = norm(name);
          const lev = (a, b) => {
            const m = a.length, n = b.length;
            const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
            for (let j = 0; j <= n; j++) dp[0][j] = j;
            for (let i = 1; i <= m; i++)
              for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            return dp[m][n];
          };

          // Build duplicate match
          let match = null;
          for (const v of vendors) {
            const vNorm = norm(v.name);
            if (vNorm === qNorm) { match = { ...v, exactMatch: true }; break; }
            if (!match && (vNorm.startsWith(qNorm) || qNorm.startsWith(vNorm) || lev(qNorm, vNorm) <= 2)) {
              match = { ...v, exactMatch: false };
            }
          }
          setDupMatch(match);
          setConfirmedDifferent(false);
          setSearchResults(vendors.slice(0, 5));
        })
        .catch(() => { setSearchResults([]); setDupMatch(null); })
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [form.vendorName, form.existingVendorId]);

  /* ── Helpers ──────────────────────────────────── */
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleDay = (d) => setForm(f => ({
    ...f,
    deliveryDays: f.deliveryDays.includes(d)
      ? f.deliveryDays.filter(x => x !== d)
      : [...f.deliveryDays, d],
  }));

  const linkExistingVendor = (v) => {
    setForm(f => ({
      ...f,
      existingVendorId: v.vendorId,
      vendorName:       v.name,
      category:         v.category || f.category,
      website:          v.website  || f.website,
    }));
    setSearchResults([]);
    setDupMatch(null);
    setStep(1); // jump straight to ordering
  };

  const clearVendor = () => {
    setForm(f => ({ ...f, existingVendorId: null, vendorName: "", category: "" }));
    setStep(0);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  /* ── Validation ───────────────────────────────── */
  const validateStep = (s) => {
    const e = {};
    if (s === 0) {
      if (!form.vendorName.trim()) e.vendorName = "Vendor name is required";
      if (!form.category)          e.category   = "Please select a category";
    }
    if (s === 1) {
      if (!form.deliveryMethod) e.deliveryMethod = "Delivery method is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(s + 1, 3)); };
  const goBack = () => setStep(s => Math.max(s - 1, 0));

  // Blocked if exact match and user hasn't confirmed it's different
  const dupBlocked = !!dupMatch && !form.existingVendorId && (dupMatch.exactMatch || !confirmedDifferent);

  /* ── Submit ───────────────────────────────────── */
  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             "vendor-add",
          account,
          vendorName:         form.vendorName.trim(),
          category:           form.category,
          website:            form.website.trim(),
          notes:              form.notes.trim(),
          accountNotes:       form.accountNotes.trim(),
          customerAccountNum: form.customerAccountNum.trim(),
          salesRepName:       form.salesRepName.trim(),
          salesRepPhone:      form.salesRepPhone.trim(),
          salesRepEmail:      form.salesRepEmail.trim(),
          deliveryDays:       form.deliveryDays.join(", "),
          cutoffTime:         form.cutoffTime.trim(),
          deliveryMethod:     form.deliveryMethod,
          portalUrl:          form.portalUrl.trim() || form.website.trim(),
          portalUsername:     form.portalUsername.trim(),
          portalPassword:     form.portalPassword,
          paymentTerms:       form.paymentTerms,
          minOrder:           form.minOrder,
          existingVendorId:   form.existingVendorId || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onCreated({
          vendorId:     data.vendorId,
          name:         form.vendorName.trim(),
          category:     form.category,
          deliveryDays: form.deliveryDays.join(", "),
          deliveryMethod: form.deliveryMethod,
          paymentTerms: form.paymentTerms,
          salesRepName: form.salesRepName.trim(),
          portalUrl:    form.portalUrl.trim() || form.website.trim(),
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

  /* ── Step bar ─────────────────────────────────── */
  const StepBar = () => (
    <div className="oh-inv-vs-stepper">
      {STEPS.map((s, i) => (
        <div key={s.key} className={`oh-inv-vs-step${i < step ? " oh-inv-vs-step--done" : ""}${i === step ? " oh-inv-vs-step--active" : ""}`}>
          <div className="oh-inv-vs-step-dot">
            {i < step ? <CheckIcon /> : <span>{i + 1}</span>}
          </div>
          <span className="oh-inv-vs-step-label">{s.label}</span>
          {i < STEPS.length - 1 && <div className="oh-inv-vs-step-line" />}
        </div>
      ))}
    </div>
  );

  /* ── Field helper ─────────────────────────────── */
  const renderField = (label, name, { type = "text", required, placeholder, fullWidth, children } = {}) => (
    <div className={`oh-inv-vs-field${fullWidth ? " oh-inv-vs-field--full" : ""}${errors[name] ? " oh-inv-vs-field--error" : ""}`}>
      <label>
        {label}
        {required && <span className="oh-inv-vs-req">*</span>}
      </label>
      {children || (
        <input
          type={type}
          value={form[name] || ""}
          onChange={e => { set(name, e.target.value); if (errors[name]) setErrors(p => ({ ...p, [name]: undefined })); }}
          placeholder={placeholder || ""}
          autoComplete="off"
        />
      )}
      {errors[name] && <span className="oh-inv-vs-field-error">{errors[name]}</span>}
    </div>
  );

  /* ── Step 0: Vendor ───────────────────────────── */
  const renderBasics = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>

      {/* Linked vendor confirmation card */}
      {form.existingVendorId ? (
        <div className="oh-inv-vs-linked-card">
          <div className="oh-inv-vs-linked-card-info">
            <LinkIcon />
            <div>
              <span className="oh-inv-vs-linked-name">{form.vendorName}</span>
              {form.category && <span className="oh-inv-vs-linked-cat" style={{ background: (CATEGORY_COLORS[form.category] || "#64748b") + "20", color: CATEGORY_COLORS[form.category] || "#64748b" }}>{form.category}</span>}
              <p className="oh-inv-vs-linked-hint">Linking existing vendor to this account — global info is already set.</p>
            </div>
          </div>
          <button type="button" className="oh-inv-vs-change" onClick={clearVendor}>Change</button>
        </div>
      ) : (
        <>
          {/* Single name field — drives search + duplicate detection */}
          <div className={`oh-inv-vs-field oh-inv-vs-field--full${errors.vendorName ? " oh-inv-vs-field--error" : ""}`}>
            <label>Vendor Name <span className="oh-inv-vs-req">*</span></label>
            <input
              ref={nameInputRef}
              type="text"
              value={form.vendorName}
              onChange={e => {
                set("vendorName", e.target.value);
                if (errors.vendorName) setErrors(p => ({ ...p, vendorName: undefined }));
              }}
              placeholder="e.g. Sysco, Fresh Point, US Foods"
              autoComplete="off"
            />
            {errors.vendorName && <span className="oh-inv-vs-field-error">{errors.vendorName}</span>}
          </div>

          {/* Typeahead results — only show when no dup match is already flagged */}
          {!dupMatch && form.vendorName.trim().length >= 2 && (searchLoading || searchResults.length > 0) && (
            <div className="oh-inv-vs-typeahead">
              {searchLoading && (
                <div className="oh-inv-vs-typeahead-loading">Searching…</div>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <>
                  <p className="oh-inv-vs-typeahead-label">Already in the system — link instead of creating a duplicate</p>
                  {searchResults.map(v => (
                    <button
                      key={v.vendorId}
                      type="button"
                      className="oh-inv-vs-typeahead-item"
                      onClick={() => linkExistingVendor(v)}
                    >
                      <div className="oh-inv-vs-typeahead-name">{v.name}</div>
                      {v.category && (
                        <span className="oh-inv-vs-typeahead-cat" style={{ color: CATEGORY_COLORS[v.category] || "#64748b" }}>
                          {v.category}
                        </span>
                      )}
                      <span className="oh-inv-vs-typeahead-cta">Link to this account →</span>
                    </button>
                  ))}
                  <p className="oh-inv-vs-typeahead-divider">Not what you're looking for? Continue below to create a new vendor.</p>
                </>
              )}
            </div>
          )}

          {/* Exact match hard block */}
          {dupMatch?.exactMatch && !confirmedDifferent && (
            <div className="oh-inv-vs-dup-banner oh-inv-vs-dup-banner--hard">
              <div className="oh-inv-vs-dup-banner-text">
                <p className="oh-inv-vs-dup-exact-label">⛔ Exact match — "{dupMatch.name}" already exists</p>
                <p className="oh-inv-vs-dup-hint">Link the existing vendor to this account instead of creating a duplicate.</p>
              </div>
              <button type="button" className="oh-inv-vs-dup-btn" onClick={() => linkExistingVendor(dupMatch)}>
                Link Vendor →
              </button>
            </div>
          )}

          {/* Fuzzy match warning — requires checkbox to proceed */}
          {dupMatch && !dupMatch.exactMatch && (
            <div className="oh-inv-vs-dup-banner">
              <div className="oh-inv-vs-dup-banner-text">
                <p className="oh-inv-vs-dup-warn-label">⚠ Similar vendor found — "{dupMatch.name}"</p>
                <p className="oh-inv-vs-dup-hint">Is this the same vendor? If so, link it instead of creating a duplicate.</p>
                <label className="oh-inv-vs-dup-confirm-row">
                  <input type="checkbox" checked={confirmedDifferent} onChange={e => setConfirmedDifferent(e.target.checked)} />
                  <span>This is a different vendor — create new</span>
                </label>
              </div>
              <button type="button" className="oh-inv-vs-dup-btn" onClick={() => linkExistingVendor(dupMatch)}>
                Link Vendor →
              </button>
            </div>
          )}

          {/* Category — required */}
          <div className={`oh-inv-vs-field oh-inv-vs-field--full${errors.category ? " oh-inv-vs-field--error" : ""}`} style={{ marginTop: 16 }}>
            <label>Category <span className="oh-inv-vs-req">*</span></label>
            <div className="oh-inv-vs-day-chips">
              {CATEGORIES.map(c => (
                <button
                  key={c} type="button"
                  className={`oh-inv-vs-day-chip${form.category === c ? " oh-inv-vs-day-chip--active" : ""}`}
                  style={form.category === c ? { background: (CATEGORY_COLORS[c] || "#64748b") + "20", borderColor: CATEGORY_COLORS[c] || "#64748b", color: CATEGORY_COLORS[c] || "#64748b" } : {}}
                  onClick={() => { set("category", c); if (errors.category) setErrors(p => ({ ...p, category: undefined })); }}
                >{c}</button>
              ))}
            </div>
            {errors.category && <span className="oh-inv-vs-field-error">{errors.category}</span>}
          </div>
        </>
      )}
    </div>
  );

  /* ── Step 1: Ordering & Portal ────────────────── */
  const renderOrdering = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header"><span>📦</span><span>Ordering Details</span></div>
        <div className="oh-inv-vs-box-body">
          <div className="oh-inv-vs-field oh-inv-vs-field--full">
            <label>Delivery Days</label>
            <div className="oh-inv-vs-day-chips">
              {DAYS.map(d => (
                <button key={d} type="button"
                  className={`oh-inv-vs-day-chip${form.deliveryDays.includes(d) ? " oh-inv-vs-day-chip--active" : ""}`}
                  onClick={() => toggleDay(d)}
                >{d}</button>
              ))}
            </div>
          </div>
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            <div className="oh-inv-vs-field">
              <label>Order Cutoff</label>
              <input type="text" value={form.cutoffTime} onChange={e => set("cutoffTime", e.target.value)} placeholder="e.g. 2:00 PM" autoComplete="off" />
            </div>
            {renderField("Delivery Method", "deliveryMethod", { required: true, children: (
              <select
                value={form.deliveryMethod}
                onChange={e => { set("deliveryMethod", e.target.value); if (errors.deliveryMethod) setErrors(p => ({ ...p, deliveryMethod: undefined })); }}
                className={errors.deliveryMethod ? "oh-inv-vs-required" : ""}
              >
                <option value="">Select method…</option>
                {DELIVERY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )})}
          </div>
          {errors.deliveryMethod && <span className="oh-inv-vs-field-error" style={{ marginTop: 4 }}>{errors.deliveryMethod}</span>}
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Payment Terms", "paymentTerms", { children: (
              <select value={form.paymentTerms} onChange={e => set("paymentTerms", e.target.value)}>
                <option value="">Select terms…</option>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )})}
            {renderField("Min. Order", "minOrder", { children: (
              <div className="oh-inv-vs-dollar-wrap">
                <span className="oh-inv-vs-dollar-sign">$</span>
                <input className="oh-inv-vs-dollar-input" type="text" value={form.minOrder}
                  onChange={e => set("minOrder", e.target.value.replace(/[^0-9.]/g, ""))} />
              </div>
            )})}
          </div>
          {renderField("Customer Account #", "customerAccountNum", { placeholder: "e.g. 1234567", fullWidth: true })}
        </div>
      </div>

      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header"><GlobeIcon /><span>Ordering Portal</span></div>
        <div className="oh-inv-vs-box-body">
          {renderField("Portal URL", "portalUrl", { type: "url", placeholder: "https://order.sysco.com", fullWidth: true })}
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Username", "portalUsername", { placeholder: "login@kitchfix.com" })}
            {renderField("Password", "portalPassword", { children: (
              <div className="oh-inv-vs-pw-wrap">
                <input type={showPw ? "text" : "password"} value={form.portalPassword}
                  onChange={e => set("portalPassword", e.target.value)} placeholder="••••••••" autoComplete="off" />
                <button type="button" className="oh-inv-vs-pw-toggle" onClick={() => setShowPw(v => !v)}>
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            )})}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Step 2: Sales Rep ────────────────────────── */
  const renderRep = () => (
    <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
      <div className="oh-inv-vs-box">
        <div className="oh-inv-vs-box-header"><span>👤</span><span>Sales Representative</span></div>
        <div className="oh-inv-vs-box-body">
          {renderField("Rep Name", "salesRepName", { placeholder: "e.g. Jane Smith", fullWidth: true })}
          <div className="oh-inv-vs-grid" style={{ marginTop: 10 }}>
            {renderField("Phone", "salesRepPhone", { type: "tel", placeholder: "(555) 123-4567" })}
            {renderField("Email", "salesRepEmail", { type: "email", placeholder: "jane@vendor.com" })}
          </div>
        </div>
      </div>
      <p className="oh-inv-vs-hint">Sales rep info is optional but useful for the team when placing orders.</p>
    </div>
  );

  /* ── Step 3: Review ───────────────────────────── */
  const renderReview = () => {
    const sections = [
      {
        title: "Vendor",
        items: [
          { label: "Name",     value: form.vendorName },
          { label: "Category", value: form.category },
          form.existingVendorId && { label: "Type", value: "Linking existing vendor to this account" },
        ].filter(Boolean),
      },
      {
        title: "Ordering",
        items: [
          { label: "Delivery",  value: form.deliveryDays.length ? form.deliveryDays.join(", ") : "" },
          { label: "Cutoff",    value: form.cutoffTime },
          { label: "Method",    value: form.deliveryMethod },
          { label: "Terms",     value: form.paymentTerms },
          { label: "Min Order", value: form.minOrder ? `$${form.minOrder}` : "" },
          { label: "Acct #",    value: form.customerAccountNum },
          { label: "Portal",    value: form.portalUsername ? `${form.portalUsername} / ••••` : "" },
        ].filter(i => i.value),
      },
      {
        title: "Sales Rep",
        items: [
          { label: "Name",  value: form.salesRepName },
          { label: "Phone", value: form.salesRepPhone },
          { label: "Email", value: form.salesRepEmail },
        ].filter(i => i.value),
      },
    ];

    return (
      <div className="oh-inv-vs-step-content" style={{ animation: "oh-fadeInSlide 0.3s ease" }}>
        <div className="oh-inv-vs-grid">
          <div className="oh-inv-vs-field">
            <label>
              Site Notes
              <span style={{ fontWeight: 400, fontSize: "0.72rem", color: "#94a3b8", marginLeft: 6 }}>this account only</span>
            </label>
            <textarea className="oh-inv-vs-textarea" rows={3} value={form.accountNotes}
              onChange={e => set("accountNotes", e.target.value)}
              placeholder="e.g. Use back entrance, ask for Sarah, COD only at this location…" />
          </div>
          <div className="oh-inv-vs-field">
            <label>
              Global Notes
              <span style={{ fontWeight: 400, fontSize: "0.72rem", color: "#94a3b8", marginLeft: 6 }}>all accounts</span>
            </label>
            <textarea className="oh-inv-vs-textarea" rows={3} value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Ordering tips, quality notes, contract reminders…" />
          </div>
        </div>

        <div className="oh-inv-vs-review-card" style={{ marginTop: 16 }}>
          <div className="oh-inv-vs-review-badge">Review Summary</div>
          {sections.map(sec => sec.items.length > 0 && (
            <div key={sec.title} className="oh-inv-vs-review-section">
              <div className="oh-inv-vs-review-title">{sec.title}</div>
              {sec.items.map(it => (
                <div key={it.label} className="oh-inv-vs-review-row">
                  <span className="oh-inv-vs-review-label">{it.label}</span>
                  <span className="oh-inv-vs-review-value">{it.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 0: return renderBasics();
      case 1: return renderOrdering();
      case 2: return renderRep();
      case 3: return renderReview();
      default: return null;
    }
  };

  /* ── Render ───────────────────────────────────── */
  return (
    <div className="oh-inv-vs-overlay" onClick={onClose}>
      <div className="oh-inv-vs-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="oh-inv-vs-header">
          <h2 className="oh-inv-vs-title">
            {form.existingVendorId ? "Link Vendor" : "Add Vendor"}
          </h2>
          <button type="button" className="oh-inv-vs-close" onClick={onClose}><CloseIcon /></button>
        </div>

        {/* Stepper */}
        <StepBar />

        {/* Body */}
        <div className="oh-inv-vs-body" ref={bodyRef}>
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="oh-inv-vs-footer">
          {step > 0 && (
            <button type="button" className="oh-inv-vs-back-btn" onClick={goBack}>
              <ArrowLeft /> Back
            </button>
          )}

          <div className="oh-inv-vs-footer-right">
            {step < 3 ? (
              <button
                type="button"
                className="oh-inv-vs-save-btn"
                onClick={goNext}
                disabled={step === 0 && dupBlocked}
              >
                <span>Continue</span>
                <ArrowRight />
              </button>
            ) : (
              <button
                type="button"
                className="oh-inv-vs-save-btn"
                onClick={handleSubmit}
                disabled={saving}
              >
                {saving
                  ? <span className="oh-inv-vs-spinner" />
                  : <><span>{form.existingVendorId ? "Link Vendor" : "Create Vendor"}</span><CheckIcon /></>
                }
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}