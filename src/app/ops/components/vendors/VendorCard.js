"use client";
import { useState } from "react";

// ── Authoritative 11-category color map ──
const CATEGORY_COLORS = {
  Produce:     "#16a34a",
  Protein:     "#dc2626",
  Dairy:       "#2563eb",
  "Dry Goods": "#d97706",
  Beverage:    "#7c3aed",
  Packaging:   "#0891b2",
  Cleaning:    "#0d9488",
  Equipment:   "#475569",
  Specialty:   "#db2777",
  Broadliner:  "#9333ea",
  Other:       "#64748b",
};

function catColor(cat) {
  return CATEGORY_COLORS[cat] || "#64748b";
}

// Strip any leading "$" — returns null for empty, "None" for zero, "$X" otherwise
function formatMoney(val) {
  if (val === null || val === undefined || val === "") return null;
  const stripped = String(val).replace(/^\$/, "").trim();
  if (!stripped || stripped === "0" || stripped === "0.00") return "None";
  return `$${stripped}`;
}

// FIX #7 — normalize "Mon,Wed,Fri" → "Mon, Wed, Fri" (mirrors VendorList fix)
function formatDeliveryDays(days) {
  if (!days) return "";
  return days.split(",").map((d) => d.trim()).join(", ");
}

function Field({ label, value, href, mono }) {
  if (!value || !String(value).trim()) return null;
  return (
    <div className="oh-vp-field">
      <span className="oh-vp-field-label">{label}</span>
      {href ? (
        <a className={`oh-vp-field-value oh-vp-field-link${mono ? " oh-vp-mono" : ""}`} href={href} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <span className={`oh-vp-field-value${mono ? " oh-vp-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}

function Section({ title, children }) {
  const hasContent = Array.isArray(children)
    ? children.some((c) => {
        if (!c) return false;
        if (c.props?.value !== undefined) return Boolean(String(c.props.value || "").trim());
        return true;
      })
    : Boolean(children);
  if (!hasContent) return null;
  return (
    <div className="oh-vp-card-section">
      <h4 className="oh-vp-section-title">{title}</h4>
      {children}
    </div>
  );
}

// ── Collapsible Site Notes ────────────────────────────────────────────────────
function SiteNotes({ notes }) {
  const text = String(notes).trim();
  const [expanded, setExpanded] = useState(false); // always starts collapsed

  return (
    <div className="oh-vp-card-section">
      <h4
        className="oh-vp-section-title oh-vp-section-title--toggle"
        onClick={() => setExpanded(v => !v)}
      >
        Site Notes
        <span className="oh-vp-notes-chevron" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </h4>
      <p className={`oh-vp-notes oh-vp-notes--site${expanded ? "" : " oh-vp-notes--clamped"}`}>
        {text}
      </p>
      {!expanded && (
        <button type="button" className="oh-vp-notes-expand-btn" onClick={() => setExpanded(true)}>
          Show more
        </button>
      )}
    </div>
  );
}

export default function VendorCard({
  vendor,
  accountKey,
  isAdmin,
  userEmail,
  showToast,
  openConfirm,
  loadingDetail,
  onEdit,
  onDeactivate,
  onReactivate,
  onClose,
}) {
  const [showPass, setShowPass] = useState(false);
  const color = catColor(vendor.category);

  return (
    <div className="oh-vp-card" style={{ animation: "oh-fadeInSlide 0.2s ease" }}>
{/* ── Header ── */}
      <div className="oh-vp-card-head">
        <div className="oh-vp-card-head-left">
          <button className="oh-vp-card-back" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            Back
          </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 className="oh-vp-card-name">{vendor.name}</h3>
            {loadingDetail && <span className="oh-spinner oh-vp-detail-spinner" />}
          </div>
          {vendor.category && (
            <span
              className="oh-vp-cat-badge"
              style={{ background: color + "1a", color, borderColor: color + "40" }}
            >
              {vendor.category}
            </span>
          )}
          {!vendor.active && (
            <span className="oh-vp-chip oh-vp-chip--inactive">Inactive</span>
          )}
        </div>

      </div>

      {/* ── Body ── */}
      <div className="oh-vp-card-body">

        {/* Account Details */}
        <Section title="Account Details">
          <Field label="Account #"       value={vendor.customerAccountNum} mono />
          {/* FIX #7 — formatted delivery days */}
          <Field label="Delivery Days"   value={formatDeliveryDays(vendor.deliveryDays)} />
          <Field label="Cutoff Time"     value={vendor.cutoffTime} />
          <Field label="Delivery Method" value={vendor.deliveryMethod} />
          <Field label="Payment Terms"   value={vendor.paymentTerms} />
          <Field label="Min Order"       value={formatMoney(vendor.minOrder)} />
        </Section>

        {/* Site Notes — collapsible when multi-line */}
        {vendor.accountNotes && String(vendor.accountNotes).trim() && (
          <SiteNotes notes={vendor.accountNotes} />
        )}

        {/* Sales Rep — shown first, used daily for orders */}
        <Section title="Sales Rep">
          <Field label="Name"  value={vendor.salesRepName} />
          <Field
            label="Email"
            value={vendor.salesRepEmail}
            href={vendor.salesRepEmail ? `mailto:${vendor.salesRepEmail}` : null}
          />
          <Field
            label="Phone"
            value={vendor.salesRepPhone}
            href={vendor.salesRepPhone ? `tel:${vendor.salesRepPhone}` : null}
          />
        </Section>

        {/* Contact — billing/admin contact */}
        <Section title="Contact">
          <Field label="Name"  value={vendor.contactName} />
          <Field
            label="Email"
            value={vendor.contactEmail}
            href={vendor.contactEmail ? `mailto:${vendor.contactEmail}` : null}
          />
          <Field
            label="Phone"
            value={vendor.contactPhone}
            href={vendor.contactPhone ? `tel:${vendor.contactPhone}` : null}
          />
        </Section>

        {/* Ordering Portal */}
        <Section title="Ordering Portal">
          <Field label="Username" value={vendor.portalUsername} mono />
          {vendor.portalPassword && (
            <div className="oh-vp-field">
              <span className="oh-vp-field-label">Password</span>
              <div className="oh-vp-pass-row">
                <span className="oh-vp-field-value oh-vp-mono">
                  {showPass ? vendor.portalPassword : "••••••••"}
                </span>
                <button
                  className="oh-vp-pass-toggle"
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          )}
        </Section>

        {/* Notes */}
        {vendor.notes && String(vendor.notes).trim() && (
          <div className="oh-vp-card-section">
            <h4 className="oh-vp-section-title">Notes</h4>
            <p className="oh-vp-notes">{vendor.notes}</p>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="oh-vp-card-actions">
        <button className="oh-btn oh-btn--outline" onClick={onEdit}>
          Edit
        </button>
        {vendor.portalUrl && (
          <a
            className="oh-btn oh-btn--outline oh-vp-portal-action-btn"
            href={vendor.portalUrl}
            target="_blank"
            rel="noreferrer"
          >
            Portal →
          </a>
        )}
        <div className="oh-vp-card-actions-spacer" />
        {vendor.active ? (
          <button
            className="oh-btn oh-btn--ghost oh-vp-deactivate-btn"
            onClick={onDeactivate}
          >
            Deactivate
          </button>
        ) : (
          <button className="oh-btn oh-btn--ghost oh-vp-reactivate-btn" onClick={onReactivate}>
            ↑ Reactivate
          </button>
        )}
      </div>

      {/* ── Meta footer ── */}
      {vendor.createdBy && (
        <div className="oh-vp-card-footer">
          Added by {vendor.createdBy}
          {vendor.createdAt
            ? ` on ${new Date(vendor.createdAt).toLocaleDateString()}`
            : ""}
        </div>
      )}
    </div>
  );
}