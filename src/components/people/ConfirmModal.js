"use client";

export default function ConfirmModal({ title, text, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="pp-modal-overlay" onClick={onCancel}>
      <div className="pp-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="pp-modal-header">
          <div className="pp-modal-icon" style={{ background: "#fef3c7", color: "#d97706" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="pp-card-title">{title}</h3>
        </div>
        <div style={{ padding: "0 24px 24px", fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>
          {text}
        </div>
        <div className="pp-modal-footer">
          <button className="pp-btn pp-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="pp-btn pp-btn--primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}