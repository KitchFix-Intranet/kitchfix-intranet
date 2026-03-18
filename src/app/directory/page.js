'use client';
import { useState, useEffect, useMemo } from 'react';
import TeamGrid from '../../components/directory/TeamGrid';
import DirectoryAdmin from '../../components/directory/DirectoryAdmin';
import './directory.css';

const CACHE_KEY  = 'kf_td_cache';

function getGreeting(firstName) {
  const h = new Date().getHours();
  const name = firstName ? `, ${firstName}` : '';
  if (h >= 4 && h < 10) {
    const opts = [
      `Good morning${name}. Let's make it a great service.`,
      `Rise and shine${name}. Your kitchens are counting on you.`,
      `Morning${name}. Big day ahead — you've got this.`,
    ];
    return opts[new Date().getDate() % opts.length];
  }
  if (h >= 10 && h < 14) {
    const opts = [
      `Good morning${name}. Midday push starts now.`,
      `Hey${name}. How's service looking today?`,
      `Almost lunch${name}. Keep the line moving.`,
    ];
    return opts[new Date().getDate() % opts.length];
  }
  if (h >= 14 && h < 17) {
    const opts = [
      `Good afternoon${name}. Prep mode — stay sharp.`,
      `Afternoon${name}. Evening service is right around the corner.`,
      `Hey${name}. How are the accounts looking today?`,
    ];
    return opts[new Date().getDate() % opts.length];
  }
  if (h >= 17 && h < 22) {
    const opts = [
      `Evening service${name}. Show 'em what KitchFix is made of.`,
      `Good evening${name}. It's game time — let's go.`,
      `Hey${name}. Hope tonight's service is smooth.`,
    ];
    return opts[new Date().getDate() % opts.length];
  }
  const opts = [
    `Burning the midnight oil${name}? Respect the grind.`,
    `Late night${name}. The kitchen never really sleeps.`,
    `Still at it${name}. Get some rest — big day tomorrow.`,
  ];
  return opts[new Date().getDate() % opts.length];
}

const PINS_KEY   = 'kf_pinned_v1';
const CACHE_TTL  = 6 * 60 * 60 * 1000; // 6 hours

const FILTERS = ['ALL', 'MLB', 'PDC', 'MiLB'];

export default function DirectoryPage() {
  const [teams,     setTeams]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('ALL');
  const [pinned,    setPinned]    = useState([]);
  const [heroImage, setHeroImage] = useState('');
  const [firstName, setFirstName] = useState('');
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // ── Load pins from localStorage ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {}
  }, []);

  // ── Persist pins ──
  const togglePin = (id) => {
    setPinned(prev => {
      const next = prev.includes(id)
        ? prev.filter(p => p !== id)
        : [...prev, id];
      try { localStorage.setItem(PINS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ── Fetch teams (cache-first) ──
  useEffect(() => {
    const tryCache = () => {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { teams, ts } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) return null;
        return teams;
      } catch { return null; }
    };

    const cached = tryCache();
    if (cached) setTeams(cached); // render cards immediately from cache

    (async () => {
      try {
        const res = await fetch('/api/directory?action=bootstrap');
        const data = await res.json();
        if (data.success && data.teams) {
          setTeams(data.teams);
          if (data.heroImage) setHeroImage(data.heroImage);
          if (data.firstName) setFirstName(data.firstName);
          if (data.isAdmin)   setIsAdmin(data.isAdmin);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ teams: data.teams, ts: Date.now() }));
          } catch {}
        }
      } catch (err) {
        console.error('[Directory] Bootstrap failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Filtered + sorted teams: pinned first, then rest ──
  const displayTeams = useMemo(() => {
    // Public view: active accounts only
    let list = teams.filter(t => t.active !== false);

    if (filter !== 'ALL') {
      list = list.filter(t => t.level === filter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q)    ||
        t.city.toLowerCase().includes(q)    ||
        t.state.toLowerCase().includes(q)   ||
        t.stadium.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    }

    const pinnedSet = new Set(pinned);
    const top  = list.filter(t => pinnedSet.has(t.id));
    const rest = list.filter(t => !pinnedSet.has(t.id));
    return [...top, ...rest];
  }, [teams, filter, search, pinned]);

  return (
    <div className="td-page">

      {/* ── Hero ── */}
      <div className="td-bound">
        <div
          className="td-hero"
          style={heroImage ? { backgroundImage: `url('${heroImage}')` } : {}}
        >
          <div className="td-hero-overlay" />
          <div className="td-hero-content">
            <h1 className="td-hero-title">Team Directory</h1>
            <p className="td-hero-sub">
              {loading ? 'Loading…' : getGreeting(firstName)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="td-bound">
      <div className="td-controls td-controls--inner">
        <div className="td-search-wrap">
          <svg className="td-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="td-search-input"
            type="text"
            placeholder="Search teams, cities, stadiums…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="td-filter-chips">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`td-chip${filter === f ? ' td-chip--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button
            className="td-admin-gear"
            onClick={() => setAdminOpen(true)}
            aria-label="Open directory admin"
            title="Directory Admin"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
      </div>

      {/* ── Grid ── */}
      <div className="td-bound">
      <TeamGrid
        teams={displayTeams}
        loading={loading}
        pinned={pinned}
        onTogglePin={togglePin}
      />
      </div>

      {/* ── Admin Drawer ── */}
      {adminOpen && (
        <div className="td-admin-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAdminOpen(false); }}>
          <div className="td-admin-drawer">
            <DirectoryAdmin
              teams={teams}
              onClose={() => setAdminOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}