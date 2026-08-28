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

// 2026-08-28 fix (owner verify of #873): the client's account state
// must render the previewed account in the command bar chip, not
// "ALL". #873 shipped with a landing-redirect that pushed
// `?account=<landing>` when the URL had no explicit account, so a
// corporate hitting `?preview=CIN - AZ` got URL rewritten to
// `?preview=CIN - AZ&account=ALL`. Data was correct (server preview
// intersection wins), but the chip read "ALL" while showing Goodyear
// numbers - "worse than a cosmetic issue on a board where account
// identity is how you know whose figures you are looking at".
//
// Precedence (highest to lowest):
//   1. previewAccount     - server says preview is active
//   2. urlAccount         - explicit ?account= from the URL
//   3. landingAccount     - the caller's default landing
//   4. "" (empty)
//
// A single-account user lands on their own account (their scope IS
// their landing). Preview replicates that exactly - the previewed
// account is the chip.
//
// Pure function so a probe can prove: with preview set, the chip
// value equals the preview value regardless of what the URL account
// or the caller's landing account carries.
export function deriveClientAccount({ urlAccount = "", previewAccount = null, landingAccount = "" }) {
  if (previewAccount) return previewAccount;
  if (urlAccount) return urlAccount;
  if (landingAccount) return landingAccount;
  return "";
}

// 2026-08-28 URL clean-up. The labor page has TWO auto-inject-account
// sites triggered when the URL arrives without ?account=: the landing
// redirect (guarded in #874) and the localStorage last-account restore.
// Kevin reported ?preview=CIN - AZ still rewriting to
// ?preview=CIN - AZ&account=ALL - traced to the second site.
//
// Both need the same guard: SKIP the auto-inject when the URL has a
// ?preview=. Preview supplies the effective account server-side;
// appending &account=<something> here would leave the URL contradicting
// itself. Factored as a pure decision so the probe pins the rule:
// "no preview -> restore if saved valid; preview set -> never restore."
export function shouldRestoreLastAccount({
  urlAccount = "",
  urlPreview = "",
  saved = null,
  savedIsValidAccount = false,
}) {
  if (urlAccount) return false;
  if (urlPreview) return false;
  if (!saved) return false;
  if (saved === "CIN - OH") return false;
  if (!savedIsValidAccount) return false;
  return true;
}

// 2026-08-28 salary-only auto-enable. Owner ruling: CIN - KY and
// TBJ - NY have zero hourly rows, so their default board is the
// StateSalaried empty state telling the user to flip + Salary. Derive
// from data.account_state === "salaried_only" (server-classified, not
// hardcoded) so any future salary-only account gets the same treatment.
//
// Ref-per-account so if a user turns the toggle OFF we respect that
// choice on the same account. Navigating to a different account and
// back does not re-fire either - preserved through the mount session.
// A fresh page load resets the ref and auto-enables once more.
export function shouldAutoEnableSalary({
  accountState = null,
  salaryParam = null,
  autoSalaryForAccount = null,
  currentAccount = "",
}) {
  if (accountState !== "salaried_only") return false;
  if (salaryParam === "1") return false;
  if (!currentAccount) return false;
  if (autoSalaryForAccount === currentAccount) return false;
  return true;
}

// 2026-08-28 stuck landing-bridge skeleton. Kevin caught an empty
// .kpi-statebox rendering permanently below the signal cards on
// ?preview=CIN - KY. The state chain in page.js has a branch:
//
//   loadState === "ok" && !urlAccount && data?.landing_account
//     -> <StateLoading />
//
// designed to bridge the tiny window while the landing-redirect
// effect pushes ?account=<landing> onto the URL. #874 gated that
// redirect on `if (data?.preview_account) return;` (correct - preview
// supplies the effective account, no redirect needed). Result: on
// preview URLs the redirect never fires and this branch would render
// StateLoading forever. Owner-verified assertion: "no preview URL
// renders a statebox when loadState === 'ok'" - meaning no statebox
// fires as a side effect of preview being active. Salary / refused /
// empty-range stateboxes still render when the DATA warrants them;
// this rule pins only the preview-caused case.
export function shouldRenderLandingBridgeLoading({
  loadState = null,
  urlAccount = "",
  landingAccount = "",
  previewAccount = null,
}) {
  if (loadState !== "ok") return false;
  if (urlAccount) return false;
  if (!landingAccount) return false;
  if (previewAccount) return false;
  return true;
}

