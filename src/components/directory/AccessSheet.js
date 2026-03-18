'use client';
import { useState } from 'react';

export default function AccessSheet({ open, team, onClose }) {
  const [copied, setCopied] = useState(null);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };

  const isWifi   = open === 'wifi';
  const isAccess = open === 'access';
  const isActive = isWifi || isAccess;

  return (
    <div className={`td-sheet${isActive ? ' td-sheet--active' : ''}`}>
      <div className="td-sheet-header">
        <span className="td-sheet-title">
          {isWifi ? '📶 WiFi' : '🔐 Access Codes'}
        </span>
        <button className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {isWifi && (
        <>
          {team.wifiName && (
            <div className="td-sheet-block">
              <span className="td-sheet-label">Network (SSID)</span>
              <div className="td-sheet-copy-row">
                <span className="td-sheet-value">{team.wifiName}</span>
                <button
                  className={`td-sheet-copy-btn${copied === 'ssid' ? ' td-sheet-copy-btn--success' : ''}`}
                  onClick={() => copy(team.wifiName, 'ssid')}
                >
                  {copied === 'ssid' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {team.wifiPass && (
            <div className="td-sheet-block">
              <span className="td-sheet-label">Password</span>
              <div className="td-sheet-copy-row">
                <span className="td-sheet-value">{team.wifiPass}</span>
                <button
                  className={`td-sheet-copy-btn${copied === 'pass' ? ' td-sheet-copy-btn--success' : ''}`}
                  onClick={() => copy(team.wifiPass, 'pass')}
                >
                  {copied === 'pass' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {!team.wifiName && !team.wifiPass && (
            <p className="td-sheet-none">No WiFi info on file.</p>
          )}
        </>
      )}

      {isAccess && (
        <>
          {team.gateCode && (
            <div className="td-sheet-block">
              <span className="td-sheet-label">Gate Code</span>
              <div className="td-sheet-copy-row">
                <span className="td-sheet-value">{team.gateCode}</span>
                <button
                  className={`td-sheet-copy-btn${copied === 'gate' ? ' td-sheet-copy-btn--success' : ''}`}
                  onClick={() => copy(team.gateCode, 'gate')}
                >
                  {copied === 'gate' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {team.doorCode && (
            <div className="td-sheet-block">
              <span className="td-sheet-label">Door Code</span>
              <div className="td-sheet-copy-row">
                <span className="td-sheet-value">{team.doorCode}</span>
                <button
                  className={`td-sheet-copy-btn${copied === 'door' ? ' td-sheet-copy-btn--success' : ''}`}
                  onClick={() => copy(team.doorCode, 'door')}
                >
                  {copied === 'door' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
          {!team.gateCode && !team.doorCode && (
            <p className="td-sheet-none">No access codes on file.</p>
          )}
        </>
      )}
    </div>
  );
}