"use client";

// SVG Icons
const WrenchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);
const UserPlusIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
    <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
  </svg>
);
const DocIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

export default function DashboardView({ counts, hasDraftNH, hasDraftPAF, isAdmin, onNavigate, onDiscardDraft }) {
  const totalPending = counts.paf + counts.newHire;
  const totalAction = counts.actionRequired;

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-grid pp-grid--dashboard">
        {/* Action Center Card — vertical layout matching other cards */}
        <div className="pp-card pp-card--interactive pp-card-action-center" onClick={() => onNavigate("activity")}>
          <div className="pp-card-header-row">
            <div className="pp-icon-box pp-icon-purple">
              <WrenchIcon />
            </div>
          </div>
          <h3 className="pp-card-title">Action Center</h3>
          <p className="pp-card-desc">Track status & requests.</p>

          {/* Chips row — urgent + processing inline */}
          <div className="pp-action-chips">
            {totalAction > 0 && (
              <div className="pp-chip pp-chip-danger" style={{ flex: 1, textAlign: "center" }}>
                ⚠️ {totalAction} Needs Action
              </div>
            )}
            {totalPending > 0 && (
              <div className="pp-chip pp-chip-blue" style={{ flex: 1, textAlign: "center" }}>
                {totalPending} Processing
              </div>
            )}
            {totalPending === 0 && totalAction === 0 && (
              <div className="pp-chip pp-chip-loading" style={{ width: "100%", textAlign: "center" }}>
                ✨ All Caught Up
              </div>
            )}
          </div>

          <button className="pp-card-cta pp-card-cta--primary" onClick={(e) => { e.stopPropagation(); onNavigate("activity"); }}>
            <span>View Activity</span>
            <ArrowRight />
          </button>
        </div>

        {/* New Hire Wizard Card */}
        <div
          className={`pp-card pp-card--interactive${hasDraftNH ? " pp-card--draft-active" : ""}`}
          onClick={() => onNavigate("newhire")}
        >
          <div className="pp-card-header-row">
            <div className="pp-icon-box pp-icon-blue"><UserPlusIcon /></div>
            {hasDraftNH && <span className="pp-badge-draft">DRAFT SAVED</span>}
          </div>
          <h3 className="pp-card-title">New Hire Wizard</h3>
          <p className="pp-card-desc">Onboard new teammates.</p>
          {hasDraftNH ? (
            <div className="pp-card-cta-group">
              <button className="pp-card-cta pp-card-cta--primary" onClick={(e) => { e.stopPropagation(); onNavigate("newhire"); }}>
                <span>Resume Draft</span>
                <ArrowRight />
              </button>
              <button
                className="pp-card-cta pp-card-cta--danger"
                onClick={(e) => { e.stopPropagation(); onDiscardDraft("newhire"); }}
              >
                Discard
              </button>
            </div>
          ) : (
            <button className="pp-card-cta pp-card-cta--primary" onClick={(e) => { e.stopPropagation(); onNavigate("newhire"); }}>
              <span>Launch Tool</span>
              <ArrowRight />
            </button>
          )}
        </div>

        {/* PAF Card */}
        <div
          className={`pp-card pp-card--interactive${hasDraftPAF ? " pp-card--draft-active" : ""}`}
          onClick={() => onNavigate("paf")}
        >
          <div className="pp-card-header-row">
            <div className="pp-icon-box pp-icon-blue"><DocIcon /></div>
            {hasDraftPAF && <span className="pp-badge-draft">DRAFT SAVED</span>}
          </div>
          <h3 className="pp-card-title">Personnel Action Form</h3>
          <p className="pp-card-desc">Submit raises and role changes.</p>
          {hasDraftPAF ? (
            <div className="pp-card-cta-group">
              <button className="pp-card-cta pp-card-cta--primary" onClick={(e) => { e.stopPropagation(); onNavigate("paf"); }}>
                <span>Resume Draft</span>
                <ArrowRight />
              </button>
              <button
                className="pp-card-cta pp-card-cta--danger"
                onClick={(e) => { e.stopPropagation(); onDiscardDraft("paf"); }}
              >
                Discard
              </button>
            </div>
          ) : (
            <button className="pp-card-cta pp-card-cta--primary" onClick={(e) => { e.stopPropagation(); onNavigate("paf"); }}>
              <span>Launch Tool</span>
              <ArrowRight />
            </button>
          )}
        </div>

        {/* Locked Cards — compact row */}
        {[
          { title: "The Academy", desc: "Training modules.", icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
          )},
          { title: "The Library", desc: "SOPs and Policies.", icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          )},
          { title: "HR Programs", desc: "Referral bonuses.", icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          )},
        ].map((card) => (
          <div key={card.title} className="pp-card pp-card--locked pp-card--locked-compact">
            <div className="pp-locked-row">
              <div className="pp-icon-box-sm pp-icon-grey">{card.icon}</div>
              <div className="pp-locked-text">
                <h3 className="pp-card-title" style={{ margin: 0, fontSize: 15 }}>{card.title}</h3>
                <p className="pp-card-desc" style={{ margin: 0, fontSize: 12 }}>{card.desc}</p>
              </div>
              <span className="pp-badge-coming">Q3</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}