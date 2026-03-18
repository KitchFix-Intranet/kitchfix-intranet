'use client';
import { useState, useEffect } from 'react';
import ContactList from './ContactList';
import AccessSheet from './AccessSheet';

// ── Weather ──
function getWeatherIcon(code) {
  if (code === 0)                   return '☀️';
  if (code >= 1  && code <= 3)      return '⛅';
  if (code >= 45 && code <= 48)     return '🌫️';
  if (code >= 51 && code <= 67)     return '🌧️';
  if (code >= 71 && code <= 77)     return '❄️';
  if (code >= 80 && code <= 82)     return '🌧️';
  if (code >= 95)                   return '⛈️';
  return '🌡️';
}

// ── Level badge helper ──
function levelClass(level) {
  if (level === 'PDC')  return 'td-level-badge td-level-badge--pdc';
  if (level === 'MiLB') return 'td-level-badge td-level-badge--milb';
  if (level === 'CORP') return 'td-level-badge td-level-badge--corp';
  return 'td-level-badge';
}

// ── Action link definitions ──
const ACTIONS = [
  {
    key: 'Homestand',
    label: 'Homestand',
    icon: (
      <svg className="td-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    key: 'Service Level Agreement (SLA)',
    label: 'Service Level Agreement (SLA)',
    icon: (
      <svg className="td-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    key: 'Service Calendars',
    label: 'Service Calendars',
    icon: (
      <svg className="td-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
        <line x1="8"  y1="14" x2="8.01" y2="14" />
        <line x1="12" y1="14" x2="12.01" y2="14" />
        <line x1="16" y1="14" x2="16.01" y2="14" />
      </svg>
    ),
  },
  {
    key: 'Drive',
    label: 'Drive Folder',
    icon: (
      <svg className="td-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

function MapIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9"  y1="3"  x2="9"  y2="18" />
      <line x1="15" y1="6"  x2="15" y2="21" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ── Contact avatar preview (used on corp card front) ──
function ContactAvatarRow({ contacts }) {
  const preview = contacts.slice(0, 4);
  const overflow = contacts.length - preview.length;
  return (
    <div className="td-corp-avatar-row">
      {preview.map((c, i) => {
        const initials = c.name
          ? c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
          : '?';
        return (
          <div
            key={i}
            className="td-corp-avatar"
            style={{ zIndex: preview.length - i }}
            title={c.name}
          >
            {initials}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="td-corp-avatar td-corp-avatar--more">+{overflow}</div>
      )}
    </div>
  );
}

export default function TeamCard({ team, index, pinned, onTogglePin }) {
  const [flipped,       setFlipped]       = useState(false);
  const [sheetOpen,     setSheetOpen]     = useState(null);
  const [frontImg,      setFrontImg]      = useState('');
  const [frontLoaded,   setFrontLoaded]   = useState(false);
  const [backImg,       setBackImg]       = useState('');
  const [backFetched,   setBackFetched]   = useState(false);
  const [weather,       setWeather]       = useState(null);
  const [clockTime,     setClockTime]     = useState('');
  const [addrCopied,    setAddrCopied]    = useState(false);

  const isCorp = team.level === 'CORP';

  // ── Load front stadium image ──
  useEffect(() => {
    if (!team.img) return;
    if (team.img.includes('drive.google.com')) {
      const timer = setTimeout(() => {
        fetch(`/api/directory?action=drive-image&url=${encodeURIComponent(team.img)}`)
          .then(r => r.json())
          .then(d => { if (d.data) setFrontImg(d.data); })
          .catch(() => {});
      }, index * 300);
      return () => clearTimeout(timer);
    } else {
      setFrontImg(team.img);
    }
  }, [team.img, index]);

  // ── Load back map image ──
  useEffect(() => {
    if (!flipped || backFetched) return;
    setBackFetched(true);
    if (!team.gmapImg) return;
    if (team.gmapImg.includes('drive.google.com')) {
      fetch(`/api/directory?action=drive-image&url=${encodeURIComponent(team.gmapImg)}`)
        .then(r => r.json())
        .then(d => { if (d.data) setBackImg(d.data); })
        .catch(() => {});
    } else {
      setBackImg(team.gmapImg);
    }
  }, [flipped, team.gmapImg, backFetched]);

  // ── Weather ──
  useEffect(() => {
    if (!team.lat || !team.long) return;
    const timer = setTimeout(() => {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${team.lat}&longitude=${team.long}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
      )
        .then(r => r.json())
        .then(data => {
          if (data.current) {
            const temp  = Math.round(data.current.temperature_2m);
            const icon  = getWeatherIcon(data.current.weather_code);
            const style = temp >= 85 ? 'hot' : temp <= 45 ? 'cold' : 'normal';
            setWeather({ icon, temp, style });
          }
        })
        .catch(() => {});
    }, index * 300);
    return () => clearTimeout(timer);
  }, [team.lat, team.long, index]);

  // ── Local clock ──
  useEffect(() => {
    if (!team.tz) return;
    const update = () => {
      try {
        setClockTime(
          new Date().toLocaleTimeString('en-US', {
            timeZone:  team.tz,
            hour:      'numeric',
            minute:    '2-digit',
          })
        );
      } catch {}
    };
    update();
    const iv = setInterval(update, 60000);
    return () => clearInterval(iv);
  }, [team.tz]);

  const copyAddress = () => {
    if (!team.address) return;
    navigator.clipboard.writeText(team.address).then(() => {
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 2000);
    }).catch(() => {});
  };

  const mapsUrl = team.address
    ? `https://maps.google.com/?q=${encodeURIComponent(team.address)}`
    : null;

  const hasWifi   = !!(team.wifiName || team.wifiPass);
  const hasAccess = !!(team.gateCode || team.doorCode);

  const weatherPillClass = [
    'td-status-pill td-weather-pill',
    weather ? 'td-weather-pill--loaded' : '',
    weather?.style === 'hot'  ? 'td-weather-pill--hot'  : '',
    weather?.style === 'cold' ? 'td-weather-pill--cold' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`td-card${flipped ? ' td-card--flipped' : ''}${isCorp ? ' td-card--corp' : ''}`}>

      {/* ══ FRONT FACE ══ */}
      <div
        className="td-face td-face--front"
        onClick={isCorp ? () => setFlipped(true) : undefined}
        style={isCorp ? { cursor: 'pointer' } : {}}
      >
        {/* Stadium image header */}
        <div className="td-media">
          {frontImg && (
            <img
              src={frontImg}
              alt={team.stadium || team.name}
              className={`td-media-img${frontLoaded ? ' td-media-img--loaded' : ''}`}
              onLoad={() => setFrontLoaded(true)}
            />
          )}
          <span className={levelClass(team.level)}>{team.level}</span>
          <div className="td-logo">
            {team.logo
              ? <img src={team.logo} alt={`${team.name} logo`} />
              : <span className="td-logo-fallback">{team.name?.slice(0, 3).toUpperCase()}</span>
            }
          </div>
          {!isCorp && (
            <button
              className={`td-pin-btn${pinned ? ' td-pin-btn--active' : ''}`}
              onClick={() => onTogglePin(team.id)}
              aria-label={pinned ? 'Unpin team' : 'Pin team'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
        </div>

        {/* Card body */}
        <div className="td-card-body">
          <h3 className="td-team-name">{team.name}</h3>
          <div className="td-info-row">
            {(team.city || team.state) && (
              <span className="td-loc">{[team.city, team.state].filter(Boolean).join(', ')}</span>
            )}
            <span className={weatherPillClass}>
              {weather ? `${weather.icon} ${weather.temp}°F` : ''}
            </span>
            {clockTime && (
              <span className="td-status-pill td-clock-pill">🕒 {clockTime}</span>
            )}
          </div>

          {/* ── CORP: contact preview instead of links ── */}
          {isCorp ? (
            <div className="td-corp-preview">
              <p className="td-corp-label">Corporate Leadership</p>
              <ContactAvatarRow contacts={team.contacts} />
              <p className="td-corp-hint">
                {team.contacts.length} team member{team.contacts.length !== 1 ? 's' : ''} — tap to view contacts
              </p>
              <div className="td-corp-chevron">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
          ) : (
            <ul className="td-action-list">
              {ACTIONS.map(({ key, label, icon }) => {
                const url = team.links?.[key];
                return url ? (
                  <li key={key}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="td-action-btn"
                    >
                      {icon}
                      {label}
                    </a>
                  </li>
                ) : (
                  <li key={key}>
                    <span className="td-action-btn td-action-btn--disabled">
                      {icon}
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer — hidden for corp */}
        {!isCorp && (hasWifi || hasAccess) && (
          <div className="td-card-footer">
            {hasWifi && (
              <button
                className="td-footer-btn"
                onClick={() => setSheetOpen(sheetOpen === 'wifi' ? null : 'wifi')}
              >
                📶 WiFi
              </button>
            )}
            {hasAccess && (
              <button
                className="td-footer-btn"
                onClick={() => setSheetOpen(sheetOpen === 'access' ? null : 'access')}
              >
                🔐 Access
              </button>
            )}
          </div>
        )}

        {/* Flip button — hidden for corp (whole card is clickable) */}
        {!isCorp && (
          <button
            className="td-flip-btn"
            onClick={() => setFlipped(true)}
            aria-label="View address and contacts"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        <AccessSheet
          open={sheetOpen}
          team={team}
          onClose={() => setSheetOpen(null)}
        />
      </div>

      {/* ══ BACK FACE ══ */}
      <div className="td-face td-face--back">
        <div
          className="td-back-header"
          style={backImg ? { backgroundImage: `url('${backImg}')` } : {}}
        >
          <p className="td-back-label">{isCorp ? 'Corporate HQ' : 'Address'}</p>
          <h3 className="td-back-stadium">{team.stadium || team.name}</h3>
          {(team.city || team.state) && (
            <p className="td-back-city">{[team.city, team.state].filter(Boolean).join(', ')}</p>
          )}
        </div>

        {team.address && (
          <div className="td-back-addr-row">
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="td-back-addr-btn"
              >
                <MapIcon />
                Open Maps
              </a>
            )}
            <button className="td-back-addr-btn" onClick={copyAddress}>
              <CopyIcon />
              {addrCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        )}

        <ContactList contacts={team.contacts} />

        <button
          className="td-back-close"
          onClick={() => setFlipped(false)}
          aria-label="Back to card front"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}