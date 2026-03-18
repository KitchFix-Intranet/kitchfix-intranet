'use client';
import { useState } from 'react';

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
export default function DirectoryAdmin({ teams, onClose }) {
  const [tab, setTab] = useState('accounts');

  const tabs = [
    { id: 'accounts', label: 'Accounts & Links' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'heroes',   label: 'Hero Images' },
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
        </div>
      </div>

    </div>
  );
}