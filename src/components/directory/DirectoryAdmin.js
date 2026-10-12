'use client';
import { useState, useEffect, useMemo } from 'react';

// Stage 3 column grouping for the People tab. Column names match the
// 19 editable permission columns on `people`.
const PEOPLE_COL_GROUPS = [
  { title: 'Permission Flags', cols: [
    { col: 'is_ops_leadership',   type: 'bool' },
    { col: 'is_sc_access',        type: 'bool' },
    { col: 'is_sc_admin',         type: 'bool' },
    { col: 'is_sc_lock_override', type: 'bool' },
    { col: 'is_labor_admin',      type: 'bool' },
    { col: 'is_invoice_admin',    type: 'bool' },
    { col: 'is_inv_manager',      type: 'bool' },
  ]},
  { title: 'KPI', cols: [
    { col: 'kpi_role',       type: 'enum', options: [null, 'corporate', 'rdo'] },
    { col: 'kpi_scope',      type: 'text' },
    { col: 'can_see_salary', type: 'bool' },
    { col: 'is_kpi_preview', type: 'bool' },
  ]},
  { title: 'Content & Tools', cols: [
    { col: 'opd_access_tier',   type: 'enum', options: ['unrestricted', 'restricted', 'slt'] },
    { col: 'is_playbook_owner', type: 'bool' },
    { col: 'is_sous_preview',   type: 'bool' },
    { col: 'is_hr_admin',       type: 'bool' },
  ]},
  { title: 'Notifications', cols: [
    { col: 'paf_always_cc',   type: 'bool' },
    { col: 'incident_notify', type: 'enum', options: ['all', 's4_weekly', 'none'] },
  ]},
  { title: 'Routing', cols: [
    { col: 'region',             type: 'enum', options: [null, 'East', 'West', 'CORP'] },
    { col: 'sc_default_account', type: 'text' },
  ]},
];
const BOOL_COLS = new Set(PEOPLE_COL_GROUPS.flatMap((g) => g.cols.filter((c) => c.type === 'bool').map((c) => c.col)));
const ALL_PERM_COLS = PEOPLE_COL_GROUPS.flatMap((g) => g.cols.map((c) => c.col));
function enumOpts(col) {
  for (const g of PEOPLE_COL_GROUPS) for (const c of g.cols) if (c.col === col && c.options) return c.options;
  return null;
}
function labelFor(col, labels) {
  return labels?.[col] || col;
}
function fmtValue(val) {
  if (val === null || val === undefined || val === '') return 'not set';
  if (val === true) return 'ON';
  if (val === false) return 'OFF';
  return String(val);
}
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

const LINK_KEYS = [
  'Homestand',
  'Service Level Agreement (SLA)',
  'Service Calendars',
  'Drive',
];

const LEVELS = ['MLB', 'PDC', 'MiLB', 'CORP', 'Other'];

const BLANK_ACCOUNT = {
  name: '', stadium: '', city: '', state: '', season: '',
  level: 'MLB', rawKey: '',
  address: '', lat: '', long: '', tz: '',
  img: '', logo: '', gmapImg: '',
  wifiName: '', wifiPass: '', gateCode: '', doorCode: '',
  links: { Homestand: '', 'Service Level Agreement (SLA)': '', 'Service Calendars': '', Drive: '' },
};

// ── Helpers ──
function SaveBadge({ state }) {
  if (state === 'saving') return <span className="td-adm-save-badge td-adm-save-badge--saving">● Saving…</span>;
  if (state === 'saved')  return <span className="td-adm-save-badge td-adm-save-badge--saved">✓ Saved</span>;
  if (state === 'error')  return <span className="td-adm-save-badge td-adm-save-badge--error">✕ Error</span>;
  return null;
}

function Field({ label, value, onChange, mono, placeholder, fullWidth, hint }) {
  return (
    <div className={`td-adm-field${fullWidth ? ' td-adm-field--full' : ''}`}>
      {label && (
        <label className="td-adm-label">
          {label}{hint && <span className="td-adm-label-hint"> — {hint}</span>}
        </label>
      )}
      <input
        className={`td-adm-input${mono ? ' td-adm-input--mono' : ''}`}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
      />

    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="td-adm-field">
      {label && <label className="td-adm-label">{label}</label>}
      <select
        className="td-adm-input td-adm-select"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => {
          const val = typeof o === 'object' ? o.value : o;
          const lbl = typeof o === 'object' ? o.label : o;
          return <option key={val} value={val}>{lbl}</option>;
        })}
      </select>

    </div>
  );
}

function levelColor(l) {
  if (l === 'PDC')  return '#C41E3A';
  if (l === 'MiLB' || l === 'MILB') return '#9b1530';
  if (l === 'CORP') return '#334155';
  return '#0f3057';
}

// ── Full account form (shared by edit + add new) ──
function AccountForm({ ed, lnk, setField, setLink }) {
  return (
    <>
      <p className="td-adm-section-label">Basic Info</p>
      <div className="td-adm-grid td-adm-grid--3">
        <Field label="Team Name" value={ed.name} onChange={v => setField('name', v)} />
        <Field label="Stadium Name" value={ed.stadium} onChange={v => setField('stadium', v)} />
        <div className="td-adm-grid td-adm-grid--city">
          <Field label="City" value={ed.city} onChange={v => setField('city', v)} />
          <Field label="ST" value={ed.state} onChange={v => setField('state', v)} placeholder="OH" />
        </div>
      </div>
      <div className="td-adm-grid td-adm-grid--3" style={{ marginTop: 10 }}>
        <div className="td-adm-field">
        <label className="td-adm-label">Level</label>
        <select
          className="td-adm-input td-adm-select"
          value={LEVELS.includes(ed.level) ? ed.level : 'Other'}
          onChange={e => setField('level', e.target.value === 'Other' ? '' : e.target.value)}
        >
          {LEVELS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {(!LEVELS.slice(0,-1).includes(ed.level)) && (
          <input
            className="td-adm-input td-adm-input--mono"
            style={{ marginTop: 6 }}
            value={ed.level || ''}
            onChange={e => setField('level', e.target.value)}
            placeholder="Specify level…"
            autoFocus
          />
        )}
      </div>
        <Field label="Team Key" value={ed.rawKey} onChange={v => setField('rawKey', v)} mono placeholder="CIN-OH" hint="unique ID" />
        <Field label="Season" value={ed.season} onChange={v => setField('season', v)} placeholder="Year-Round" />
      </div>

      <p className="td-adm-section-label" style={{ marginTop: 16 }}>Location</p>
      <Field label="Street Address" value={ed.address} onChange={v => setField('address', v)} fullWidth placeholder="1 Riverfront Plaza, Cincinnati, OH 45202" />
      <div className="td-adm-grid td-adm-grid--3" style={{ marginTop: 10 }}>
        <Field label="Latitude" value={ed.lat} onChange={v => setField('lat', v)} mono placeholder="39.0979" />
        <Field label="Longitude" value={ed.long} onChange={v => setField('long', v)} mono placeholder="-84.5082" />
        <SelectField
          label="Timezone — IANA"
          value={ed.tz}
          onChange={v => setField('tz', v)}
          options={[
            { value: '',                      label: '— Select —' },
            { value: 'America/New_York',       label: 'Eastern  (America/New_York)' },
            { value: 'America/Chicago',        label: 'Central  (America/Chicago)' },
            { value: 'America/Denver',         label: 'Mountain (America/Denver)' },
            { value: 'America/Phoenix',        label: 'Arizona  (America/Phoenix)' },
            { value: 'America/Los_Angeles',    label: 'Pacific  (America/Los_Angeles)' },
            { value: 'America/Anchorage',      label: 'Alaska   (America/Anchorage)' },
            { value: 'Pacific/Honolulu',       label: 'Hawaii   (Pacific/Honolulu)' },
          ]}
        />
      </div>

      <p className="td-adm-section-label" style={{ marginTop: 16 }}>Images</p>
      <Field label="Stadium Header URL" value={ed.img} onChange={v => setField('img', v)} mono fullWidth hint="card background photo" placeholder="https://…" />
      <div className="td-adm-grid td-adm-grid--2" style={{ marginTop: 10 }}>
        <Field label="Logo URL" value={ed.logo} onChange={v => setField('logo', v)} mono hint="team badge" placeholder="https://…" />
        <Field label="Map Image URL" value={ed.gmapImg} onChange={v => setField('gmapImg', v)} mono hint="card-flip satellite view" placeholder="https://…" />
      </div>

      <p className="td-adm-section-label" style={{ marginTop: 16 }}>Credentials</p>
      <div className="td-adm-grid td-adm-grid--4">
        <Field label="WiFi SSID" value={ed.wifiName} onChange={v => setField('wifiName', v)} mono />
        <Field label="WiFi Password" value={ed.wifiPass} onChange={v => setField('wifiPass', v)} mono />
        <Field label="Gate Code" value={ed.gateCode} onChange={v => setField('gateCode', v)} mono />
        <Field label="Door Code" value={ed.doorCode} onChange={v => setField('doorCode', v)} mono />
      </div>

      <p className="td-adm-section-label" style={{ marginTop: 16 }}>Links</p>
      <div className="td-adm-links">
        {LINK_KEYS.map(key => (
          <div key={key} className="td-adm-link-row">
            <span className="td-adm-link-label">{key}</span>
            <input
              className={`td-adm-input td-adm-input--mono td-adm-input--url${!lnk[key] ? ' td-adm-input--empty' : ''}`}
              value={lnk[key] || ''}
              onChange={e => setLink(key, e.target.value)}
              placeholder="https://…"
            />
          </div>
        ))}
      </div>
    </>
  );
}

// ══ TAB: ACCOUNTS & LINKS ══
function AccountsTab({ teams: initialTeams }) {
  const [teamList, setTeamList]   = useState(initialTeams);
  const [expanded, setExpanded]   = useState(null);
  const [edits, setEdits]         = useState({});
  const [linkEdits, setLinkEdits] = useState({});
  const [saveState, setSaveState] = useState({});
  const [showAdd, setShowAdd]     = useState(false);
  const [newAcct, setNewAcct]     = useState({ ...BLANK_ACCOUNT, links: { ...BLANK_ACCOUNT.links } });
  const [addState, setAddState]   = useState(null);
  const [deactivating, setDeactivating]   = useState(null);
  const [reactivating, setReactivating]   = useState(null);
  const [deactivateModal, setDeactivateModal] = useState(null); // { id, name }
  const [deactivatedOpen, setDeactivatedOpen] = useState(false);

  const activeTeams      = teamList.filter(t => t.active !== false);
  const deactivatedTeams = teamList.filter(t => t.active === false);

  const toggle = (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    const t = teamList.find(t => t.id === id);
    if (!edits[id])     setEdits(p     => ({ ...p, [id]: { ...t } }));
    if (!linkEdits[id]) setLinkEdits(p => ({ ...p, [id]: { ...(t.links || {}) } }));
  };

  const setField    = (id, k, v) => setEdits(p     => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const setLink     = (id, k, v) => setLinkEdits(p => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const setNewField = (k, v)     => setNewAcct(p   => ({ ...p, [k]: v }));
  const setNewLink  = (k, v)     => setNewAcct(p   => ({ ...p, links: { ...p.links, [k]: v } }));

  const save = async (id) => {
    setSaveState(p => ({ ...p, [id]: 'saving' }));
    try {
      const res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-update-account', accountId: id, fields: edits[id], links: linkEdits[id] }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setSaveState(p => ({ ...p, [id]: 'saved' }));
      setTimeout(() => setSaveState(p => ({ ...p, [id]: null })), 2500);
    } catch {
      setSaveState(p => ({ ...p, [id]: 'error' }));
      setTimeout(() => setSaveState(p => ({ ...p, [id]: null })), 3000);
    }
  };

  const createAccount = async () => {
    if (!newAcct.name || !newAcct.rawKey) return;
    setAddState('saving');
    try {
      const res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-add-account', fields: newAcct, links: newAcct.links }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setAddState('saved');
      setTimeout(() => {
        setAddState(null);
        setShowAdd(false);
        setNewAcct({ ...BLANK_ACCOUNT, links: { ...BLANK_ACCOUNT.links } });
      }, 1500);
    } catch {
      setAddState('error');
      setTimeout(() => setAddState(null), 3000);
    }
  };

  const deactivateAccount = (id, name) => setDeactivateModal({ id, name });

  const confirmDeactivate = async () => {
    const { id } = deactivateModal;
    setDeactivateModal(null);
    setDeactivating(id);
    try {
      const res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-deactivate-account', accountId: id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      // Optimistically mark as inactive in local state
      setTeamList(p => p.map(t => t.id === id ? { ...t, active: false } : t));
      setExpanded(null);
    } catch(e) {
      alert('Deactivation failed: ' + e.message);
    } finally {
      setDeactivating(null);
    }
  };

  const reactivateAccount = async (id) => {
    setReactivating(id);
    try {
      const res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-reactivate-account', accountId: id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      // Optimistically mark as active in local state
      setTeamList(p => p.map(t => t.id === id ? { ...t, active: true } : t));
    } catch(e) {
      alert('Reactivation failed: ' + e.message);
    } finally {
      setReactivating(null);
    }
  };

  const renderAccountRow = (acct) => {
    const isOpen = expanded === acct.id;
    const ed  = edits[acct.id]     || acct;
    const lnk = linkEdits[acct.id] || acct.links || {};
    return (
      <div key={acct.id} className={`td-adm-row${isOpen ? ' td-adm-row--open' : ''}`}>
        <button className="td-adm-row-header" onClick={() => toggle(acct.id)}>
          <span className="td-adm-level-badge" style={{ background: levelColor(acct.level) }}>{acct.level}</span>
          <span className="td-adm-row-name">{acct.name}</span>
          <span className="td-adm-row-key">{acct.rawKey}</span>
          <SaveBadge state={saveState[acct.id]} />
          <svg className={`td-adm-chevron${isOpen ? ' td-adm-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isOpen && (
          <div className="td-adm-form">
            <AccountForm
              ed={ed}
              lnk={lnk}
              setField={(k, v) => setField(acct.id, k, v)}
              setLink={(k, v)  => setLink(acct.id, k, v)}
            />
            <div className="td-adm-form-footer td-adm-form-footer--split">
              <button
                className="td-adm-btn td-adm-btn--deactivate"
                onClick={() => deactivateAccount(acct.id, acct.name)}
                disabled={deactivating === acct.id}
              >
                {deactivating === acct.id ? 'Deactivating…' : 'Deactivate Account'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="td-adm-btn td-adm-btn--ghost" onClick={() => setExpanded(null)}>Cancel</button>
                <button className="td-adm-btn td-adm-btn--primary" onClick={() => save(acct.id)}>Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="td-adm-list">

      {/* ── Active Accounts ── */}
      {activeTeams.map(renderAccountRow)}

      {/* ── Add New Account ── */}
      {!showAdd ? (
        <button className="td-adm-add-btn" onClick={() => setShowAdd(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add New Account
        </button>
      ) : (
        <div className="td-adm-row td-adm-row--open td-adm-row--new">
          <div className="td-adm-row-header td-adm-row-header--new">
            <span className="td-adm-level-badge" style={{ background: levelColor(newAcct.level) }}>{newAcct.level || 'NEW'}</span>
            <span className="td-adm-row-name" style={{ opacity: newAcct.name ? 1 : 0.4 }}>{newAcct.name || 'New Account'}</span>
            <span className="td-adm-row-key" style={{ opacity: newAcct.rawKey ? 1 : 0.4 }}>{newAcct.rawKey || 'KEY'}</span>
          </div>
          <div className="td-adm-form">
            <AccountForm
              ed={newAcct}
              lnk={newAcct.links}
              setField={setNewField}
              setLink={setNewLink}
            />
            <div className="td-adm-form-footer">
              <button className="td-adm-btn td-adm-btn--ghost" onClick={() => {
                setShowAdd(false);
                setNewAcct({ ...BLANK_ACCOUNT, links: { ...BLANK_ACCOUNT.links } });
              }}>
                Cancel
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SaveBadge state={addState} />
                <button
                  className="td-adm-btn td-adm-btn--primary td-adm-btn--create"
                  onClick={createAccount}
                  disabled={!newAcct.name || !newAcct.rawKey}
                >
                  Create Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Deactivated Accounts Section ── */}
      {deactivatedTeams.length > 0 && (
        <div className="td-adm-deactivated-section">
          <button
            className="td-adm-deactivated-toggle"
            onClick={() => setDeactivatedOpen(p => !p)}
          >
            <span className="td-adm-deactivated-label">
              Deactivated Accounts
              <span className="td-adm-deactivated-count">{deactivatedTeams.length}</span>
            </span>
            <svg className={`td-adm-chevron${deactivatedOpen ? ' td-adm-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {deactivatedOpen && (
            <div className="td-adm-deactivated-list">
              {deactivatedTeams.map(acct => (
                <div key={acct.id} className="td-adm-deactivated-row">
                  <span className="td-adm-level-badge td-adm-level-badge--muted">{acct.level}</span>
                  <span className="td-adm-row-name td-adm-row-name--muted">{acct.name}</span>
                  <span className="td-adm-row-key td-adm-row-key--muted">{acct.rawKey}</span>
                  <button
                    className="td-adm-btn td-adm-btn--reactivate"
                    onClick={() => reactivateAccount(acct.id)}
                    disabled={reactivating === acct.id}
                  >
                    {reactivating === acct.id ? 'Reactivating…' : '↩ Reactivate'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Deactivate Confirmation Modal ── */}
      {deactivateModal && (
        <div className="td-adm-modal-overlay" onClick={() => setDeactivateModal(null)}>
          <div className="td-adm-modal" onClick={e => e.stopPropagation()}>
            <div className="td-adm-modal-icon">⚠️</div>
            <h3 className="td-adm-modal-title">Deactivate "{deactivateModal.name}"?</h3>
            <p className="td-adm-modal-body">
              This will hide it from the public directory and remove it from work locations.
              All data is preserved in the sheet and can be restored by reactivating.
            </p>
            <div className="td-adm-modal-actions">
              <button className="td-adm-modal-btn td-adm-modal-btn--cancel" onClick={() => setDeactivateModal(null)}>
                Cancel
              </button>
              <button
                className="td-adm-modal-btn td-adm-modal-btn--danger"
                disabled={deactivating === deactivateModal.id}
                onClick={() => confirmDeactivate()}
              >
                {deactivating === deactivateModal.id ? 'Deactivating…' : 'Yes, Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══ TAB: CONTACTS ══
function ContactForm({ draft, onChange, onSave, onCancel, saveLabel = 'Save Contact', saveDisabled }) {
  const f = (k) => <input
    className="td-adm-input"
    value={draft[k] || ''}
    onChange={e => onChange(k, e.target.value)}
    placeholder={{ name: 'Full name', role: 'Executive Chef', email: 'name@kitchfix.com', phone: '(314) 000-0000', slack: '@handle' }[k]}
    autoFocus={k === 'name'}
  />;
  return (
    <div className="td-ct-modal-body">
      <div className="td-ct-modal-row">
        <div className="td-ct-modal-group td-ct-modal-group--wide">
          <label className="td-adm-label">Full Name <span className="td-ct-required">*</span></label>
          {f('name')}
        </div>
        <div className="td-ct-modal-group">
          <label className="td-adm-label">Role / Title</label>
          {f('role')}
        </div>
      </div>
      <div className="td-ct-modal-row">
        <div className="td-ct-modal-group">
          <label className="td-adm-label">Email</label>
          {f('email')}
        </div>
        <div className="td-ct-modal-group">
          <label className="td-adm-label">Phone</label>
          {f('phone')}
        </div>
        <div className="td-ct-modal-group">
          <label className="td-adm-label">Slack Handle</label>
          {f('slack')}
        </div>
      </div>
      <div className="td-ct-modal-footer">
        <button className="td-adm-btn td-adm-btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="td-adm-btn td-adm-btn--primary" onClick={onSave} disabled={saveDisabled}>{saveLabel}</button>
      </div>
    </div>
  );
}

function ContactsTab({ teams }) {
  const filteredTeams = teams.filter(t => t.active !== false);
  const [selectedId, setSelectedId] = useState(filteredTeams[0]?.id || '');
  const [contactMap, setContactMap] = useState(
    Object.fromEntries(teams.map(t => [t.id, [...(t.contacts || [])]]))
  );
  const [modal, setModal]         = useState(null); // { mode: 'edit'|'add', idx?, draft }
  const [deleteIdx, setDeleteIdx] = useState(null); // idx pending inline delete confirm
  const [saveState, setSaveState] = useState(null);

  const contacts     = contactMap[selectedId] || [];
  const selectedTeam = filteredTeams.find(t => t.id === selectedId);

  const doSave = async (list) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-update-contacts', accountId: selectedId, contacts: list }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setSaveState('saved');
      setTimeout(() => setSaveState(null), 2500);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState(null), 3000);
    }
  };

  const openEdit = (idx) => setModal({ mode: 'edit', idx, draft: { ...contacts[idx] } });
  const openAdd  = ()    => setModal({ mode: 'add',  draft: { name: '', role: '', email: '', phone: '', slack: '' } });
  const closeModal = ()  => setModal(null);

  const setDraftField = (k, v) => setModal(p => ({ ...p, draft: { ...p.draft, [k]: v } }));

  const saveModal = () => {
    let list;
    if (modal.mode === 'edit') {
      list = contacts.map((c, i) => i === modal.idx ? { ...modal.draft } : c);
    } else {
      list = [...contacts, { ...modal.draft }];
    }
    setContactMap(p => ({ ...p, [selectedId]: list }));
    doSave(list);
    closeModal();
  };

  const confirmDelete = () => {
    const list = contacts.filter((_, i) => i !== deleteIdx);
    setContactMap(p => ({ ...p, [selectedId]: list }));
    doSave(list);
    setDeleteIdx(null);
  };

  const switchAccount = (id) => {
    setSelectedId(id);
    setModal(null);
    setDeleteIdx(null);
  };

  const initials = (name) => {
    const parts = (name || '?').trim().split(' ').filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
  };

  return (
    <div className="td-adm-contacts-wrap">

      {/* ── Account selector bar ── */}
      <div className="td-ct-header">
        <div className="td-ct-selector-wrap">
          <label className="td-ct-selector-label">Account</label>
          <div className="td-ct-selector-inner">
            <span className="td-adm-level-badge" style={{ background: levelColor(selectedTeam?.level), flexShrink: 0 }}>
              {selectedTeam?.level}
            </span>
            <select
              className="td-adm-account-select td-ct-select"
              value={selectedId}
              onChange={e => switchAccount(e.target.value)}
            >
              {filteredTeams.map(t => (
                <option key={t.id} value={t.id}>{t.name} — {t.rawKey}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="td-ct-header-right">
          <span className="td-ct-count">
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          </span>
          <SaveBadge state={saveState} />
          <button className="td-adm-btn td-adm-btn--primary td-ct-add-btn" onClick={openAdd}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Contact
          </button>
        </div>
      </div>

      {/* ── Contact list ── */}
      <div className="td-ct-list">
        {contacts.length === 0 ? (
          <div className="td-adm-ct-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/>
            </svg>
            <p>No contacts yet for <strong>{selectedTeam?.name}</strong></p>
            <button className="td-adm-btn td-adm-btn--primary" onClick={openAdd}>Add First Contact</button>
          </div>
        ) : (
          <>
            <div className="td-ct-table-head">
              <span style={{ flex: '0 0 44px' }} />
              <span className="td-ct-th" style={{ flex: '1 1 180px' }}>Name</span>
              <span className="td-ct-th" style={{ flex: '0 0 110px' }}>Role</span>
              <span className="td-ct-th" style={{ flex: '1 1 200px' }}>Email</span>
              <span className="td-ct-th" style={{ flex: '0 0 130px' }}>Phone</span>
              <span className="td-ct-th" style={{ flex: '0 0 120px' }}>Slack</span>
              <span style={{ flex: '0 0 110px' }} />
            </div>

            {contacts.map((c, idx) => (
              <div key={idx} className={`td-ct-row${deleteIdx === idx ? ' td-ct-row--deleting' : ''}`}>
                <div className="td-ct-avatar">{initials(c.name)}</div>
                <div className="td-ct-cell td-ct-cell--name" style={{ flex: '1 1 180px' }}>
                  <span className="td-ct-name">{c.name || '—'}</span>
                </div>
                <div className="td-ct-cell" style={{ flex: '0 0 110px' }}>
                  <span className="td-ct-role-pill">{c.role || <span style={{ color: '#cbd5e1' }}>—</span>}</span>
                </div>
                <div className="td-ct-cell" style={{ flex: '1 1 200px', minWidth: 0 }}>
                  {c.email
                    ? <a className="td-ct-link" href={`mailto:${c.email}`}>{c.email}</a>
                    : <span style={{ color: '#cbd5e1' }}>—</span>}
                </div>
                <div className="td-ct-cell td-ct-mono" style={{ flex: '0 0 130px' }}>{c.phone || <span style={{ color: '#cbd5e1' }}>—</span>}</div>
                <div className="td-ct-cell td-ct-mono" style={{ flex: '0 0 120px' }}>{c.slack || <span style={{ color: '#cbd5e1' }}>—</span>}</div>

                <div className="td-ct-actions" style={{ flex: '0 0 110px' }}>
                  {deleteIdx === idx ? (
                    <div className="td-ct-delete-confirm">
                      <span className="td-ct-delete-prompt">Remove?</span>
                      <button className="td-ct-confirm-btn td-ct-confirm-btn--yes" onClick={confirmDelete}>Yes</button>
                      <button className="td-ct-confirm-btn td-ct-confirm-btn--no" onClick={() => setDeleteIdx(null)}>No</button>
                    </div>
                  ) : (
                    <>
                      <button className="td-ct-btn td-ct-btn--edit" onClick={() => openEdit(idx)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit
                      </button>
                      <button className="td-ct-btn td-ct-btn--del" onClick={() => setDeleteIdx(idx)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/>
                          <path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Edit / Add Modal ── */}
      {modal && (
        <div className="td-adm-modal-overlay" onClick={closeModal}>
          <div className="td-ct-modal" onClick={e => e.stopPropagation()}>
            <div className="td-ct-modal-header">
              <div className="td-ct-modal-title-wrap">
                <h3 className="td-adm-modal-title" style={{ margin: 0 }}>
                  {modal.mode === 'edit' ? 'Edit Contact' : 'Add Contact'}
                </h3>
                <span className="td-ct-modal-subtitle">{selectedTeam?.name}</span>
              </div>
              <button className="td-ct-modal-close" onClick={closeModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <ContactForm
              draft={modal.draft}
              onChange={setDraftField}
              onSave={saveModal}
              onCancel={closeModal}
              saveLabel={modal.mode === 'edit' ? 'Save Changes' : 'Add Contact'}
              saveDisabled={!modal.draft.name?.trim()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ══ TAB: HERO IMAGES ══
function HeroTab() {
  const [urls, setUrls]           = useState([]);
  const [newUrl, setNewUrl]       = useState('');
  const [saveState, setSaveState] = useState(null);
  const [loaded, setLoaded]       = useState(false);

  if (!loaded) {
    setLoaded(true);
    fetch('/api/directory?action=hero-list')
      .then(r => r.json())
      .then(d => { if (d.urls) setUrls(d.urls); })
      .catch(() => {});
  }

  const doSave = async (list) => {
    setSaveState('saving');
    try {
      await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-update-heroes', urls: list }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState(null), 2000);
    } catch { setSaveState(null); }
  };

  const add = () => {
    const trimmed = newUrl.trim();
    if (!trimmed || urls.includes(trimmed)) return;
    const list = [...urls, trimmed];
    setUrls(list);
    setNewUrl('');
    doSave(list);
  };

  const remove = (idx) => {
    const list = urls.filter((_, i) => i !== idx);
    setUrls(list);
    doSave(list);
  };

  return (
    <div>
      <p className="td-adm-hero-desc">These images rotate randomly in the directory hero on every page load.</p>
      {urls.length > 0 && (
        <div className="td-adm-hero-list">
          {urls.map((url, idx) => (
            <div key={idx} className="td-adm-hero-item">
              <div className="td-adm-hero-thumb" style={{ backgroundImage: `url(${url})` }} />
              <span className="td-adm-hero-url">{url}</span>
              <button className="td-adm-btn td-adm-btn--sm td-adm-btn--danger-icon" onClick={() => remove(idx)}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="td-adm-hero-add">
        <input
          className="td-adm-input td-adm-input--mono"
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Paste image URL and press Enter or click Add…"
        />
        <button className="td-adm-btn td-adm-btn--primary" onClick={add}>Add Image</button>
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <SaveBadge state={saveState} />
      </div>

    </div>
  );
}

// ══ MAIN EXPORT ══
// ═══════════════════════════════════════════════════════════════════
// Stage 3 - People / Permissions / Changelog tabs
// ═══════════════════════════════════════════════════════════════════

function PeopleTab({ initialSelectEmail }) {
  const [people, setPeople] = useState(null);
  const [labels, setLabels] = useState({});
  const [search, setSearch] = useState('');
  // userSelectedEmail reflects an explicit click; the effective
  // selection also honors the jumped-to email prop and the first
  // person as the final fallback. Derived at render below.
  const [userSelectedEmail, setUserSelectedEmail] = useState(null);
  const [pending, setPending] = useState(null); // { col, newValue, reason }
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [errMsg, setErrMsg] = useState('');

  // Fetch admin-people-list once on mount. The cancelled-boolean
  // pattern guards the setState calls if the component unmounts
  // mid-request; the eslint-disable is for the react-hooks/set-state-
  // in-effect rule which heuristically flags any setState in an
  // effect body even when it is inside an async callback (standard
  // data-fetching effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/directory?action=admin-people-list');
        const d = await r.json();
        if (cancelled) return;
        if (!d.success) { setPeople([]); return; }
        setPeople(d.people || []);
        setLabels(d.columnLabels || {});
      } catch {
        if (!cancelled) setPeople([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = search.trim().toLowerCase();
    const list = q
      ? people.filter((p) =>
          (p.display_name || '').toLowerCase().includes(q)
          || (p.work_email || '').toLowerCase().includes(q)
          || (p.title || '').toLowerCase().includes(q))
      : people;
    return list;
  }, [people, search]);

  function permCount(p) {
    return ALL_PERM_COLS.reduce((n, c) => {
      const v = p[c];
      if (BOOL_COLS.has(c)) return n + (v === true ? 1 : 0);
      if (c === 'incident_notify') return n + (v && v !== 'none' ? 1 : 0);
      if (c === 'opd_access_tier') return n + (v && v !== 'unrestricted' ? 1 : 0);
      return n + (v != null && v !== '' ? 1 : 0);
    }, 0);
  }

  // Effective selection: honor user click first, then the jumped-to
  // email from the Permissions tab, then fall back to the first row.
  const effectiveEmail = useMemo(() => {
    if (userSelectedEmail) return userSelectedEmail;
    if (initialSelectEmail && people) {
      const hit = people.find((p) => (p.work_email || '').toLowerCase() === initialSelectEmail.toLowerCase());
      if (hit) return hit.work_email;
    }
    if (people && people.length) return people[0].work_email;
    return null;
  }, [userSelectedEmail, initialSelectEmail, people]);
  const selectedEmail = effectiveEmail;
  const selected = people?.find((p) => p.work_email === selectedEmail) || null;

  function requestChange(col, newValue) {
    if (!selected) return;
    // Super-admin guard: do not allow is_ops_leadership flip for allowlist members
    if (col === 'is_ops_leadership' && selected.is_super_admin) return;
    setPending({ col, newValue, reason: '' });
    setSaveState('idle');
    setErrMsg('');
  }
  async function commitChange() {
    if (!pending || !selected) return;
    const reason = pending.reason.trim();
    if (reason.length === 0) { setErrMsg('Reason is required.'); return; }
    if (reason.length > 280)   { setErrMsg('Reason must be <= 280 chars.'); return; }
    setSaveState('saving');
    setErrMsg('');
    try {
      const r = await fetch('/api/directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-people-update',
          email:  selected.work_email,
          column: pending.col,
          value:  pending.newValue,
          reason,
        }),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        setSaveState('error');
        setErrMsg(data.error || `HTTP ${r.status}`);
        return;
      }
      // Patch local people list
      setPeople((prev) => (prev || []).map((p) =>
        p.work_email === selected.work_email ? { ...p, [pending.col]: pending.newValue } : p
      ));
      setSaveState('saved');
      setTimeout(() => { setPending(null); setSaveState('idle'); }, 700);
    } catch (e) {
      setSaveState('error');
      setErrMsg(e.message || 'network error');
    }
  }

  if (!people) return <p className="td-adm-people-loading">Loading people…</p>;

  return (
    <div className="td-adm-people">
      <aside className="td-adm-people-list">
        <input
          className="td-adm-input td-adm-people-search"
          type="search"
          placeholder="Search name, email, title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search people"
        />
        <div className="td-adm-people-rows">
          {filtered.map((p) => {
            const sel = selectedEmail === p.work_email;
            const n = permCount(p);
            return (
              <button
                key={p.work_email || p.worker_id}
                className={`td-adm-people-row${sel ? ' td-adm-people-row--sel' : ''}`}
                onClick={() => { setUserSelectedEmail(p.work_email); setPending(null); }}
              >
                <div className="td-adm-people-row-main">
                  <div className="td-adm-people-row-name">
                    {p.display_name}
                    {p.is_super_admin && <span className="td-adm-super-pill">SUPER</span>}
                  </div>
                  <div className="td-adm-people-row-sub">{p.title || '—'}</div>
                </div>
                <span className="td-adm-people-perm-count">{n}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="td-adm-people-empty">No matches.</p>}
        </div>
      </aside>

      <section className="td-adm-people-detail">
        {selected ? (
          <>
            <header className="td-adm-people-head">
              <div>
                <h3 className="td-adm-people-name">
                  {selected.display_name}
                  {selected.is_super_admin && <span className="td-adm-super-pill">SUPER ADMIN</span>}
                </h3>
                <p className="td-adm-people-meta">{selected.title || '—'} · {selected.work_email || 'no work email'}</p>
                {selected.is_super_admin && (
                  <p className="td-adm-people-note">Super Admin — access protected by code (SUPER_ADMINS). Ops leadership toggle is disabled.</p>
                )}
              </div>
            </header>

            {PEOPLE_COL_GROUPS.map((g) => (
              <div key={g.title} className="td-adm-people-group">
                <h4 className="td-adm-people-group-title">{g.title}</h4>
                <div className="td-adm-people-rows-grid">
                  {g.cols.map((c) => {
                    const val = selected[c.col];
                    const label = labelFor(c.col, labels);
                    const disabled = c.col === 'is_ops_leadership' && selected.is_super_admin;
                    const pendingHere = pending && pending.col === c.col;
                    return (
                      <div key={c.col} className={`td-adm-perm-row${pendingHere ? ' td-adm-perm-row--pending' : ''}`}>
                        <div className="td-adm-perm-row-label">
                          <span className="td-adm-perm-row-name">{label}</span>
                          <code className="td-adm-perm-row-col">{c.col}</code>
                        </div>
                        <div className="td-adm-perm-row-control">
                          {c.type === 'bool' && (
                            <button
                              type="button"
                              className={`td-adm-toggle${val ? ' td-adm-toggle--on' : ''}${disabled ? ' td-adm-toggle--disabled' : ''}`}
                              onClick={() => !disabled && requestChange(c.col, !val)}
                              disabled={disabled}
                              aria-pressed={!!val}
                              aria-label={label}
                            >
                              <span className="td-adm-toggle-knob" />
                              <span className="td-adm-toggle-label">{val ? 'ON' : 'OFF'}</span>
                            </button>
                          )}
                          {c.type === 'enum' && (
                            <select
                              className="td-adm-input td-adm-select td-adm-perm-select"
                              value={val == null ? '' : String(val)}
                              onChange={(e) => {
                                const v = e.target.value === '' ? null : e.target.value;
                                requestChange(c.col, v);
                              }}
                            >
                              {(c.options || []).map((o) => {
                                const key = o == null ? '__null' : o;
                                const show = o == null ? '— none —' : o;
                                return <option key={key} value={o == null ? '' : o}>{show}</option>;
                              })}
                            </select>
                          )}
                          {c.type === 'text' && (
                            <input
                              className="td-adm-input td-adm-perm-text"
                              type="text"
                              defaultValue={val || ''}
                              placeholder="(unset)"
                              onBlur={(e) => {
                                const next = e.target.value.trim() || null;
                                if ((val || null) === next) return;
                                requestChange(c.col, next);
                              }}
                            />
                          )}
                        </div>
                        {pendingHere && (
                          <div className="td-adm-perm-pending">
                            <div className="td-adm-perm-pending-head">
                              <strong>{label}</strong>: {fmtValue(val)} → {fmtValue(pending.newValue)}
                            </div>
                            <textarea
                              className="td-adm-input td-adm-perm-reason"
                              rows={2}
                              maxLength={280}
                              placeholder="Why? (required)"
                              value={pending.reason}
                              onChange={(e) => setPending((p) => ({ ...p, reason: e.target.value }))}
                            />
                            <div className="td-adm-perm-pending-actions">
                              <button type="button" className="td-adm-btn-cancel" onClick={() => { setPending(null); setSaveState('idle'); setErrMsg(''); }}>
                                Cancel
                              </button>
                              <button type="button" className="td-adm-btn-save" onClick={commitChange} disabled={saveState === 'saving'}>
                                {saveState === 'saving' ? 'Saving…' : 'Save'}
                              </button>
                              <SaveBadge state={saveState} />
                              {errMsg && <span className="td-adm-perm-err">{errMsg}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        ) : (
          <p className="td-adm-people-empty">Select a person to edit their permissions.</p>
        )}
      </section>
    </div>
  );
}

function PermissionsTab({ onJumpToPerson }) {
  const [labels, setLabels] = useState({});
  const [column, setColumn] = useState('is_ops_leadership');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Hydrate labels once from the people-list action (shares the map).
  // Cancelled-boolean + eslint disable on the setState: standard
  // data-fetching effect that the heuristic lint rule flags.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/directory?action=admin-people-list');
        const d = await r.json();
        if (cancelled) return;
        setLabels(d.columnLabels || {});
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Spinner flip is intentional on every column change; the data
    // load happens in the inner IIFE below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/directory?action=admin-permissions-view&column=${encodeURIComponent(column)}`);
        const d = await r.json();
        if (cancelled) return;
        setData(d.success ? d : null);
        setLoading(false);
      } catch {
        if (!cancelled) { setData(null); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [column]);

  return (
    <div className="td-adm-perm">
      <div className="td-adm-perm-head">
        <label className="td-adm-label">Show people with</label>
        <select
          className="td-adm-input td-adm-select"
          value={column}
          onChange={(e) => setColumn(e.target.value)}
        >
          {ALL_PERM_COLS.map((c) => (
            <option key={c} value={c}>{labelFor(c, labels)}</option>
          ))}
        </select>
      </div>
      {loading && <p className="td-adm-people-loading">Loading…</p>}
      {!loading && data && (
        <div className="td-adm-perm-results">
          <h4 className="td-adm-perm-results-title">
            {data.label} <span className="td-adm-perm-results-count">({data.people.length})</span>
          </h4>
          {data.people.length === 0 && <p className="td-adm-people-empty">No one has this today.</p>}
          <ul className="td-adm-perm-results-list">
            {data.people.map((p) => (
              <li key={p.work_email || p.worker_id} className="td-adm-perm-results-row">
                <button
                  type="button"
                  className="td-adm-perm-results-btn"
                  onClick={() => onJumpToPerson && onJumpToPerson(p.work_email)}
                >
                  <div>
                    <div className="td-adm-perm-results-name">{p.display_name}</div>
                    <div className="td-adm-perm-results-sub">{p.title || '—'} · {p.work_email}</div>
                  </div>
                  <span className="td-adm-perm-results-val">{fmtValue(p.value)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChangelogTab() {
  const PAGE = 50;
  const [entries, setEntries] = useState([]);
  const [labels, setLabels] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  async function load(off) {
    setLoading(true);
    const r = await fetch(`/api/directory?action=admin-changelog&limit=${PAGE}&offset=${off}`);
    const d = await r.json();
    if (d.success) {
      setEntries((prev) => off === 0 ? (d.entries || []) : [...prev, ...(d.entries || [])]);
      setTotal(d.total || 0);
      if (d.columnLabels) setLabels(d.columnLabels);
    }
    setLoading(false);
  }
  // Initial load. Fetch effect; eslint disable per the same rationale
  // as the other data-fetching effects in this file.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(0);
  }, []);

  function diffLine(e) {
    const label = labelFor(e.column_name, labels);
    return `${label}: ${fmtValue(e.old_value)} → ${fmtValue(e.new_value)}`;
  }

  return (
    <div className="td-adm-log">
      <p className="td-adm-log-count">{total} entr{total === 1 ? 'y' : 'ies'} total</p>
      <ol className="td-adm-log-list">
        {entries.map((e) => (
          <li key={e.id} className="td-adm-log-row">
            <div className="td-adm-log-row-main">
              <div className="td-adm-log-who">
                <strong>{e.person_name || e.person_email}</strong>
                <span className="td-adm-log-email">{e.person_email}</span>
              </div>
              <div className="td-adm-log-diff">{diffLine(e)}</div>
              {e.reason && <div className="td-adm-log-reason">“{e.reason}”</div>}
            </div>
            <div className="td-adm-log-meta">
              <div className="td-adm-log-by">by {e.changed_by}</div>
              <div className="td-adm-log-when" title={e.changed_at}>{relTime(e.changed_at)}</div>
            </div>
          </li>
        ))}
      </ol>
      {entries.length < total && (
        <button
          type="button"
          className="td-adm-log-more"
          onClick={() => { const next = offset + PAGE; setOffset(next); load(next); }}
          disabled={loading}
        >
          {loading ? 'Loading…' : `Load more (${total - entries.length} left)`}
        </button>
      )}
    </div>
  );
}

export default function DirectoryAdmin({ teams, onClose, isAdmin = true, isPeopleAdmin = false }) {
  const [tab, setTab] = useState(isAdmin ? 'accounts' : 'people');
  const [jumpEmail, setJumpEmail] = useState(null);

  const tabs = [
    ...(isAdmin ? [
      { id: 'accounts', label: 'Accounts & Links' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'heroes',   label: 'Hero Images' },
    ] : []),
    ...(isPeopleAdmin ? [
      { id: 'people',      label: 'People' },
      { id: 'permissions', label: 'Permissions' },
      { id: 'changelog',   label: 'Changelog' },
    ] : []),
  ];

  return (
    <div className="td-adm">
      <div className="td-adm-header">
        <div className="td-adm-header-left">
          <button className="td-adm-back" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Directory
          </button>
          <div className="td-adm-header-divider" />
          <span className="td-adm-title">Directory Admin</span>
          <span className="td-adm-badge">ADMIN</span>
        </div>
        <div className="td-adm-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`td-adm-tab${tab === t.id ? ' td-adm-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="td-adm-close" onClick={onClose} aria-label="Close admin panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="td-adm-body">
        <div className="td-adm-bound">
          <h2 className="td-adm-section-title">{tabs.find(t => t.id === tab)?.label}</h2>
          {tab === 'accounts' && <AccountsTab teams={teams} />}
          {tab === 'contacts' && <ContactsTab teams={teams} />}
          {tab === 'heroes'   && <HeroTab />}
          {tab === 'people'      && <PeopleTab initialSelectEmail={jumpEmail} />}
          {tab === 'permissions' && <PermissionsTab onJumpToPerson={(email) => { setJumpEmail(email); setTab('people'); }} />}
          {tab === 'changelog'   && <ChangelogTab />}
        </div>
      </div>

    </div>
  );
}