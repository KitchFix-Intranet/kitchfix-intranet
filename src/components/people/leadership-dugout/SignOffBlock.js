"use client";

// ════════════════════════════════════════════════════════════════════════════
// SignOffBlock — digital signature capture
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Renders an "I have reviewed and acknowledge" checkbox + signed-by name.
// Once signed, becomes read-only with name + ISO timestamp.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";

export default function SignOffBlock({
  role,
  signerName,
  signedAt,
  onSign,
  acknowledgmentText,
}) {
  const [signing, setSigning] = useState(false);

  if (signedAt) {
    const dt = new Date(signedAt);
    return (
      <div className="pp-ldug-signoff pp-ldug-signoff--signed">
        <div className="pp-ldug-signoff-role">{role}</div>
        <div className="pp-ldug-signoff-signer">{signerName}</div>
        <div className="pp-ldug-signoff-timestamp">
          Signed {dt.toLocaleDateString()} at {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    );
  }

  const label =
    acknowledgmentText ||
    `I have reviewed this in full and acknowledge it as my ${role.toLowerCase()} sign-off.`;

  return (
    <div className="pp-ldug-signoff pp-ldug-signoff--pending">
      <div className="pp-ldug-signoff-role">{role}</div>
      <label className="pp-ldug-signoff-check">
        <input
          type="checkbox"
          disabled={signing}
          onChange={async (e) => {
            if (!e.target.checked) return;
            setSigning(true);
            try {
              await onSign?.();
            } catch (err) {
              console.error("[SignOffBlock] sign failed:", err);
              setSigning(false);
            }
          }}
        />
        <span>{label}</span>
      </label>
      <div className="pp-ldug-signoff-name">Signing as: <strong>{signerName}</strong></div>
    </div>
  );
}