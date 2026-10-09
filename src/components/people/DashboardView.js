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
const AlertTriangleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);
const ArrowRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);
const DirectoryIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export default function DashboardView({ counts, hasDraftNH, hasDraftPAF, isAdmin, onNavigate, onDiscardDraft }) {
  const totalPending = counts.paf + counts.newHire;
  const totalAction = counts.actionRequired;
  // P4B: user's own open incidents (non-closed). Reflects on the launchpad
  // pill so "All Caught Up" doesn't lie when they have an active incident.
  const openIncidents = counts.openIncidents || 0;
  const allCaughtUp = totalPending === 0 && totalAction === 0 && openIncidents === 0;

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

          {/* Chips row — urgent + processing + open incidents inline */}
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
            {/* P4B: open incidents render as a neutral "in progress" pill.
                Distinct from "Needs Action" — user doesn't have to do anything,
                but their case isn't done yet. Reads as a status update, not a task. */}
            {openIncidents > 0 && (
              <div className="pp-chip pp-chip-blue" style={{ flex: 1, textAlign: "center" }}>
                🔍 {openIncidents} In Progress
              </div>
            )}
            {allCaughtUp && (
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

{/* Incident Reporting Card */}
        <div
          className="pp-card pp-card--interactive"
          onClick={() => onNavigate("incidents")}
        >
          <div className="pp-card-header-row">
            <div className="pp-icon-box pp-icon-purple"><AlertTriangleIcon /></div>
          </div>
          <h3 className="pp-card-title">Incident Reporting</h3>
          <p className="pp-card-desc">Report injuries, vehicle, allergen, food safety and other incidents.</p>
          <button
            className="pp-card-cta pp-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("incidents"); }}
          >
            <span>Launch Tool</span>
            <ArrowRight />
          </button>
        </div>

        {/* Team Directory Card */}
        <div
          className="pp-card pp-card--interactive"
          onClick={() => onNavigate("directory")}
        >
          <div className="pp-card-header-row">
            <div className="pp-icon-box pp-icon-blue"><DirectoryIcon /></div>
          </div>
          <h3 className="pp-card-title">Team Directory</h3>
          <p className="pp-card-desc">Find teammates across every account - names, roles, and contact info.</p>
          <button
            className="pp-card-cta pp-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("directory"); }}
          >
            <span>Open Directory</span>
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}