'use client';
import TeamCard from './TeamCard';

function SkeletonCard() {
  return (
    <div className="td-skeleton">
      <div className="td-skeleton-img" />
      <div className="td-skeleton-body">
        <div className="td-skeleton-line td-skeleton-line--title" />
        <div className="td-skeleton-line td-skeleton-line--sub" />
        <div className="td-skeleton-line td-skeleton-line--btn" />
        <div className="td-skeleton-line td-skeleton-line--btn" />
        <div className="td-skeleton-line td-skeleton-line--btn" />
        <div className="td-skeleton-line td-skeleton-line--btn" />
      </div>
    </div>
  );
}

export default function TeamGrid({ teams, loading, pinned, onTogglePin }) {
  if (loading) {
    return (
      <div className="td-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <div className="td-grid">
        <div className="td-empty">
          <svg className="td-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className="td-empty-text">No teams found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="td-grid">
      {teams.map((team, index) => (
        <TeamCard
          key={team.id}
          team={team}
          index={index}
          pinned={pinned.includes(team.id)}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}