// Preview narrows only. Never grants.
//
// Owner ruling 2026-08-28 (CC_PROMPT_RAIL_AND_PREVIEW). The safety
// property is structural, not a check:
//
//   effective = preview ? intersect(realAccess, preview) : realAccess
//   empty intersection returns realAccess, not nothing
//
// This probe exercises resolvePreviewAccess() with fixture callers
// covering every role class and asserts that:
//
//   A1  no caller can EVER see an account via preview that
//        canViewAccount would refuse
//   A2  preview_account is null whenever preview didn't narrow
//        (including the empty-intersection case and the no-preview
//        case)
//   A3  when preview is granted (Kevin's use case), effective
//        account IS the preview value and preview_account IS the
//        preview value
//
// The gate function is stubbed to mirror src/lib/kpi/roleGate.js
// canViewAccount exactly:
//   corporate -> all
//   rdo       -> all (aggregate ok)
//   site_*    -> own scope only, pseudos denied

import {
  resolvePreviewAccess,
  deriveClientAccount,
  shouldRestoreLastAccount,
  shouldAutoEnableSalary,
  shouldRenderLandingBridgeLoading,
} from "../../src/lib/kpi/previewAccess.js";

const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

// Mirror of roleGate.canViewAccount. If the real gate ever changes,
// update this too - the probe's job is to prove intersection is
// enforced against the LIVE gate shape.
function canViewAccount(caller, requestedAccount) {
  if (!caller || !requestedAccount) return false;
  const { role, scope } = caller;
  if (role === "corporate") return true;
  if (role === "rdo") return true;
  if (PSEUDO_KEYS.has(requestedAccount)) return false;
  return requestedAccount === scope;
}

const CALLERS = [
  { label: "corporate",           caller: { role: "corporate", scope: null } },
  { label: "rdo (East)",          caller: { role: "rdo", scope: "East" } },
  { label: "site_leader STL-MO",  caller: { role: "site_leader", scope: "STL - MO" } },
  { label: "site_manager CIN-OH", caller: { role: "site_manager", scope: "CIN - OH" } },
];

const PREVIEW_VALUES = [
  "",                // no preview
  "CIN - AZ",        // real account
  "STL - MO",        // real account (matches one caller's scope)
  "CORP",            // not a real account, not a pseudo
  "ALL",             // pseudo
  "EAST",            // pseudo
  "WEST",            // pseudo
  "NON - EXISTENT",  // garbage
];

const URL_ACCOUNTS = [
  "",                // typical Kevin URL: /kpi/labor?preview=X (no account)
  "STL - MO",        // explicit account, some caller's scope
  "CIN - OH",        // explicit account, some caller's scope
];

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log("=== preview narrows only, never grants ===\n");

// Exhaustive Cartesian - every caller x every preview x every URL account.
// The A1 assertion is the safety property: preview cannot INTRODUCE
// an account the caller cannot view. Note: this does not assert the
// URL account is viewable - route.js line 385 canViewAccount handles
// that path with a locked response. resolvePreviewAccess's job is to
// not make things worse than the URL already asked for.
let a1Cases = 0, a1Failures = 0;
let a2Cases = 0, a2Failures = 0;
let a1bCases = 0, a1bFailures = 0;
for (const { label, caller } of CALLERS) {
  for (const preview of PREVIEW_VALUES) {
    for (const url of URL_ACCOUNTS) {
      const r = resolvePreviewAccess({ caller, canViewAccount, urlAccount: url, previewParam: preview });

      // A1 - core safety. If preview_account is set (preview took
      // effect), canViewAccount MUST have said yes for that value.
      // This is the intersection property in code.
      a1Cases++;
      if (r.preview_account !== null) {
        const ok = canViewAccount(caller, r.preview_account);
        if (!ok) {
          a1Failures++;
          console.log(`  ✗ A1  ${label} preview="${preview}" url="${url}" -> preview_account="${r.preview_account}" (canViewAccount says NO - PREVIEW GRANTED FORBIDDEN ACCESS)`);
        }
      }

      // A1b - preview never CHANGES the returned account to
      // something the URL didn't already ask for unless preview
      // is in real access. Formally: r.account !== url implies
      // r.account === preview AND canViewAccount(caller, preview).
      a1bCases++;
      if (r.account !== (url || "").trim()) {
        const changedByPreview = r.account === preview.trim();
        const gateOk = canViewAccount(caller, preview.trim());
        if (!changedByPreview || !gateOk) {
          a1bFailures++;
          console.log(`  ✗ A1b  ${label} preview="${preview}" url="${url}" -> account="${r.account}" (account changed but not by an allowed preview)`);
        }
      }

      // A2 - preview_account non-null iff preview took effect
      // (preview was non-empty AND passed the gate).
      a2Cases++;
      const previewTookEffect = !!preview.trim() && canViewAccount(caller, preview.trim());
      const expected = previewTookEffect ? preview.trim() : null;
      if (r.preview_account !== expected) {
        a2Failures++;
        console.log(`  ✗ A2  ${label} preview="${preview}" url="${url}" -> preview_account=${JSON.stringify(r.preview_account)}, expected ${JSON.stringify(expected)}`);
      }
    }
  }
}
assert(`A1   preview_account signal implies canViewAccount pass (${a1Cases} cases)`, a1Failures === 0);
assert(`A1b  preview never changes account without gate pass (${a1bCases} cases)`, a1bFailures === 0);
assert(`A2   preview_account signals iff preview took effect (${a2Cases} cases)`, a2Failures === 0);

// A3 - named scenarios matching Kevin's spec verbatim.
console.log("\nA3  named scenarios from the spec:");
{
  const kevin = { role: "corporate", scope: null };
  const leader = { role: "site_leader", scope: "STL - MO" };

  // "As Kevin (CORP): rail present, all accounts listed"
  // Without preview, corporate resolves to url or landing (empty here).
  const kevinNoPreview = resolvePreviewAccess({ caller: kevin, canViewAccount, urlAccount: "", previewParam: "" });
  assert("A3a  Kevin (corporate), no preview: preview_account is null",
    kevinNoPreview.preview_account === null && kevinNoPreview.account === "",
    kevinNoPreview);

  // "?preview=CIN - AZ: no rail, board fills the width, banner visible naming the account"
  const kevinPreviewCinAz = resolvePreviewAccess({ caller: kevin, canViewAccount, urlAccount: "", previewParam: "CIN - AZ" });
  assert("A3b  Kevin (corporate), preview=CIN - AZ: account=CIN - AZ, preview_account=CIN - AZ",
    kevinPreviewCinAz.account === "CIN - AZ" && kevinPreviewCinAz.preview_account === "CIN - AZ",
    kevinPreviewCinAz);

  // "Preview cannot widen. Assert that a single-account identity
  // with ?preview=CORP still resolves to their own account. This is
  // the assertion that matters most."
  const leaderPreviewCorp = resolvePreviewAccess({ caller: leader, canViewAccount, urlAccount: "", previewParam: "CORP" });
  assert("A3c  site_leader, preview=CORP: preview silently ignored (preview_account null, account unchanged)",
    leaderPreviewCorp.preview_account === null && leaderPreviewCorp.account === "",
    leaderPreviewCorp);

  // Site leader trying to preview another site
  const leaderPreviewOther = resolvePreviewAccess({ caller: leader, canViewAccount, urlAccount: "", previewParam: "CIN - OH" });
  assert("A3d  site_leader (STL - MO), preview=CIN - OH: preview silently ignored",
    leaderPreviewOther.preview_account === null && leaderPreviewOther.account === "",
    leaderPreviewOther);

  // Site leader trying to preview a pseudo aggregate
  const leaderPreviewAll = resolvePreviewAccess({ caller: leader, canViewAccount, urlAccount: "", previewParam: "ALL" });
  assert("A3e  site_leader, preview=ALL: preview silently ignored (pseudos are gate-denied for site roles)",
    leaderPreviewAll.preview_account === null && leaderPreviewAll.account === "",
    leaderPreviewAll);
}

// A4 - the chip. Owner ruling 2026-08-28 after #873 verify: with
// ?preview=<account>, the rendered account chip equals the preview
// account. Not just that the data matches. #873 shipped with a
// landing-redirect that pushed ?account=ALL onto the URL when
// preview was set but ?account= was absent, so the chip showed
// "ALL" while the board showed Goodyear.
//
// The display account is derived by deriveClientAccount() from
// (urlAccount, previewAccount, landingAccount) with preview at the
// top of the precedence stack. This assertion pins the rule: any
// combination that has preview set MUST resolve to preview,
// regardless of what the URL or landing carries.
console.log("\nA4  chip account tracks preview_account (the #873 verify bug):");
{
  const previews = ["CIN - AZ", "STL - MO", "TXR - TX - H"];
  const urls = ["", "ALL", "CIN - OH", "EAST"];
  const landings = ["ALL", "EAST", "WEST", "CIN - OH"];
  let checked = 0, failed = 0;
  for (const preview of previews) {
    for (const url of urls) {
      for (const landing of landings) {
        checked++;
        const displayed = deriveClientAccount({ urlAccount: url, previewAccount: preview, landingAccount: landing });
        if (displayed !== preview) {
          failed++;
          console.log(`  ✗ A4  preview="${preview}" url="${url}" landing="${landing}" -> chip="${displayed}", expected "${preview}"`);
        }
      }
    }
  }
  assert(`A4  chip=preview when preview is set (${checked} cases)`, failed === 0);
}

// A4b - the specific bug Kevin hit: ?preview=CIN - AZ&account=ALL
// as a corporate user landing=ALL must render CIN - AZ in the chip.
{
  const chip = deriveClientAccount({ urlAccount: "ALL", previewAccount: "CIN - AZ", landingAccount: "ALL" });
  assert(`A4b  #873 verify bug: preview=CIN - AZ + account=ALL renders chip="CIN - AZ" (was "ALL")`,
    chip === "CIN - AZ",
    { chip });
}

// A4c - precedence stack: no preview -> URL wins over landing;
// no URL, no preview -> landing; nothing -> "".
{
  assert(`A4c  no preview, URL set: chip=URL`,
    deriveClientAccount({ urlAccount: "CIN - OH", previewAccount: null, landingAccount: "ALL" }) === "CIN - OH");
  assert(`A4c  no preview, no URL: chip=landing`,
    deriveClientAccount({ urlAccount: "", previewAccount: null, landingAccount: "ALL" }) === "ALL");
  assert(`A4c  no preview, no URL, no landing: chip=""`,
    deriveClientAccount({ urlAccount: "", previewAccount: null, landingAccount: "" }) === "");
}

// A5 - shouldRestoreLastAccount. The 2026-08-28 URL clean-up fix.
// Kevin reported that ?preview=CIN - AZ still ended up as
// ?preview=CIN - AZ&account=ALL because the localStorage-based
// last-account restore fired unconditionally when the URL had no
// ?account=. Guard added: when URL carries ?preview=, skip restore.
console.log("\nA5  URL clean-up: last-account restore respects ?preview=:");
{
  // Fix-2 bug case (Kevin's report): preview set, no explicit account,
  // localStorage has "ALL" from prior session.
  assert("A5a  preview set + no url account + saved=ALL: DO NOT restore",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "CIN - AZ", saved: "ALL", savedIsValidAccount: true,
    }) === false);

  // No preview, valid saved -> restore (baseline behaviour, unchanged).
  assert("A5b  no preview + no url account + saved valid: restore",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "", saved: "CIN - AZ", savedIsValidAccount: true,
    }) === true);

  // URL already has an account -> caller returns early before this
  // decision fires. Simulated: url present should still say "do not
  // restore" (the effect skips this branch entirely; helper mirrors it).
  assert("A5c  url account present: DO NOT restore (caller has priority)",
    shouldRestoreLastAccount({
      urlAccount: "STL - MO", urlPreview: "", saved: "CIN - AZ", savedIsValidAccount: true,
    }) === false);

  // Saved is CIN - OH (V6 special-case: user's landing-default that
  // predates the pseudo-key era; do not persist to avoid re-injecting
  // an old landing).
  assert("A5d  saved=CIN - OH: DO NOT restore (V6 exclusion)",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "", saved: "CIN - OH", savedIsValidAccount: true,
    }) === false);

  // Saved is invalid (renamed account or garbage).
  assert("A5e  saved value not in ACCOUNTS/PSEUDO_KEYS: DO NOT restore",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "", saved: "GHOST - TX", savedIsValidAccount: false,
    }) === false);

  // Empty localStorage.
  assert("A5f  no saved value: DO NOT restore",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "", saved: null, savedIsValidAccount: false,
    }) === false);

  // Preview + no url + saved is a real account (not ALL) - still skip.
  assert("A5g  preview set + saved=CIN - OH: DO NOT restore (preview wins)",
    shouldRestoreLastAccount({
      urlAccount: "", urlPreview: "STL - MO", saved: "CIN - OH", savedIsValidAccount: true,
    }) === false);
}

// A6 - shouldAutoEnableSalary. The 2026-08-28 salary-only fix. Owner
// ruling: CIN - KY and TBJ - NY (any account with zero hourly rows)
// should default the salary toggle ON so the board shows numbers
// instead of the StateSalaried empty-state prompt. Derive from
// data.account_state === "salaried_only" (server-classified), not
// hardcoded team_keys. Respect user opt-out via ref-per-account.
console.log("\nA6  salary auto-enable: salaried_only accounts flip on:");
{
  // Happy path: CIN - KY renders salaried_only, no salary param, no
  // prior auto-enable for this account -> flip on.
  assert("A6a  salaried_only + no salary param + first render: enable",
    shouldAutoEnableSalary({
      accountState: "salaried_only", salaryParam: null,
      autoSalaryForAccount: null, currentAccount: "CIN - KY",
    }) === true);

  // Same board, but user has manually flipped ON via URL - do not
  // re-fire (idempotent).
  assert("A6b  salaried_only + salary=1 already: DO NOT re-enable",
    shouldAutoEnableSalary({
      accountState: "salaried_only", salaryParam: "1",
      autoSalaryForAccount: null, currentAccount: "CIN - KY",
    }) === false);

  // User just turned salary OFF (salaryParam becomes null, ref
  // remembers we already auto-enabled once for this account) - respect
  // opt-out.
  assert("A6c  salaried_only + salary off + ref matches account: DO NOT re-enable (user opt-out)",
    shouldAutoEnableSalary({
      accountState: "salaried_only", salaryParam: null,
      autoSalaryForAccount: "CIN - KY", currentAccount: "CIN - KY",
    }) === false);

  // Navigating to a different salaried_only account fires fresh.
  assert("A6d  salaried_only + ref matches PRIOR account: enable for new account",
    shouldAutoEnableSalary({
      accountState: "salaried_only", salaryParam: null,
      autoSalaryForAccount: "CIN - KY", currentAccount: "TBJ - NY",
    }) === true);

  // Non-salaried-only account never auto-enables.
  assert("A6e  account_state hourly_only: DO NOT enable",
    shouldAutoEnableSalary({
      accountState: "hourly_only", salaryParam: null,
      autoSalaryForAccount: null, currentAccount: "STL - MO",
    }) === false);

  assert("A6f  account_state mixed: DO NOT enable",
    shouldAutoEnableSalary({
      accountState: "mixed", salaryParam: null,
      autoSalaryForAccount: null, currentAccount: "STL - MO",
    }) === false);

  // Data not loaded yet - do not enable (would spam URL replaces).
  assert("A6g  accountState=null (data not yet loaded): DO NOT enable",
    shouldAutoEnableSalary({
      accountState: null, salaryParam: null,
      autoSalaryForAccount: null, currentAccount: "CIN - KY",
    }) === false);

  // currentAccount empty -> skip (chip resolves to "" during initial
  // render; would set ref to "" and misfire on all future accounts).
  assert("A6h  currentAccount empty: DO NOT enable (ref would poison)",
    shouldAutoEnableSalary({
      accountState: "salaried_only", salaryParam: null,
      autoSalaryForAccount: null, currentAccount: "",
    }) === false);
}

// A7 - shouldRenderLandingBridgeLoading. The 2026-08-28 stuck-skeleton
// fix. Kevin caught an empty .kpi-statebox rendering permanently below
// the signal cards on ?preview=CIN - KY. The landing-bridge branch had
// no preview guard - the redirect it was bridging never fires under
// preview, so the loading box would render forever. Owner ruling:
// "no preview URL renders a statebox when loadState === 'ok'" - no
// statebox fires as a side effect of preview being active. This helper
// pins the specific preview-caused case.
console.log("\nA7  landing-bridge StateLoading does not fire on preview URLs:");
{
  // The critical Kevin bug: preview set, no urlAccount, landing set,
  // loadState ok -> should NOT render (previously did, permanently).
  assert("A7a  loadState=ok + no urlAccount + landing set + PREVIEW set: DO NOT render",
    shouldRenderLandingBridgeLoading({
      loadState: "ok", urlAccount: "", landingAccount: "ALL", previewAccount: "CIN - KY",
    }) === false);

  // Baseline: same shape without preview - render (the transient
  // landing-redirect bridge is still valid).
  assert("A7b  loadState=ok + no urlAccount + landing set + no preview: render (bridge)",
    shouldRenderLandingBridgeLoading({
      loadState: "ok", urlAccount: "", landingAccount: "ALL", previewAccount: null,
    }) === true);

  // urlAccount present -> not a bridge case.
  assert("A7c  urlAccount present: DO NOT render (bridge does not apply)",
    shouldRenderLandingBridgeLoading({
      loadState: "ok", urlAccount: "CIN - OH", landingAccount: "ALL", previewAccount: null,
    }) === false);

  // No landing_account -> can't bridge to anything.
  assert("A7d  no landing_account: DO NOT render",
    shouldRenderLandingBridgeLoading({
      loadState: "ok", urlAccount: "", landingAccount: "", previewAccount: null,
    }) === false);

  // loadState not ok -> other branches own the render.
  assert("A7e  loadState=loading: DO NOT render",
    shouldRenderLandingBridgeLoading({
      loadState: "loading", urlAccount: "", landingAccount: "ALL", previewAccount: null,
    }) === false);
  assert("A7f  loadState=error: DO NOT render",
    shouldRenderLandingBridgeLoading({
      loadState: "error", urlAccount: "", landingAccount: "ALL", previewAccount: null,
    }) === false);

  // Cartesian: for every preview value with loadState=ok, if preview
  // is set the branch must skip. This is the "no preview URL renders
  // this statebox" property in code.
  let cases = 0, fails = 0;
  const PREVIEWS_NON_EMPTY = ["CIN - AZ", "STL - MO", "CIN - KY", "TBJ - NY"];
  const URLS = ["", "ALL", "CIN - OH", "STL - MO"];
  const LANDINGS = ["", "ALL", "EAST", "WEST", "CIN - OH"];
  for (const preview of PREVIEWS_NON_EMPTY) {
    for (const url of URLS) {
      for (const landing of LANDINGS) {
        cases++;
        const r = shouldRenderLandingBridgeLoading({
          loadState: "ok", urlAccount: url, landingAccount: landing, previewAccount: preview,
        });
        if (r !== false) {
          fails++;
          console.log(`  ✗ A7  preview=${preview} url=${url} landing=${landing} -> ${r} (must be false when preview set)`);
        }
      }
    }
  }
  assert(`A7g  preview set + loadState=ok: NEVER renders (${cases} cases)`, fails === 0);
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed. Preview may have granted forbidden access - STOP and investigate.`);
  process.exit(1);
}
console.log(`all assertions pass. Preview narrows only + chip tracks preview + URL restore respects preview + salary auto-enable respects opt-out + landing-bridge does not fire on preview.`);
