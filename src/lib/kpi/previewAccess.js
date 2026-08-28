// src/lib/kpi/previewAccess.js
//
// 2026-08-28 preview mode - "Kevin sees exactly what a single-account
// user sees" without impersonating anyone. The safety property is
// STRUCTURAL, not a check:
//
//   Preview can only NARROW access, never grant it.
//
// This function is the safety property in code. It intersects a
// requested preview account against the caller's real access via
// the existing canViewAccount gate. If the intersection is empty
// (preview not in real access), preview is silently ignored and
// the caller's normal access is returned. There is no path where
// preview can grant an account that canViewAccount would refuse.
//
// The gate function is passed in rather than imported so the probe
// can run this with synthetic gates and cover every role class in
// isolation.

/**
 * @param {object} args
 * @param {object|null} args.caller       role gate caller shape (may be null; treated as no-preview)
 * @param {(caller:object, account:string) => boolean} args.canViewAccount
 * @param {string} args.urlAccount        raw ?account= param from the URL
 * @param {string} args.previewParam      raw ?preview= param from the URL
 * @returns {{ account: string, preview_account: string|null }}
 *   account         the account the route should treat as effective
 *                   (preview when in real access; else urlAccount)
 *   preview_account non-null iff preview actually took effect
 *                   (client uses this to render the banner and hide
 *                   the folio rail for corporate/rdo previewers)
 */
export function resolvePreviewAccess({ caller, canViewAccount, urlAccount = "", previewParam = "" }) {
  const url = (urlAccount || "").trim();
  const preview = (previewParam || "").trim();

  // No preview requested -> pass through.
  if (!preview) return { account: url, preview_account: null };

  // Preview requested but caller cannot view it -> SILENTLY IGNORE.
  // This is the mathematical intersection. The empty case returns
  // real access (represented here as the URL account); no branch
  // path can bypass canViewAccount and reach a grant. If a future
  // refactor adds a branch that returns preview without this gate
  // passing, the probe fails at the exhaustive fixture stage.
  if (!caller || !canViewAccount(caller, preview)) {
    return { account: url, preview_account: null };
  }

  // Preview is in real access. Narrow to it.
  return { account: preview, preview_account: preview };
}
