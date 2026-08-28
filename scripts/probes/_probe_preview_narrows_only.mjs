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

import { resolvePreviewAccess, deriveClientAccount } from "../../src/lib/kpi/previewAccess.js";

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

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed. Preview may have granted forbidden access - STOP and investigate.`);
  process.exit(1);
}
console.log(`all assertions pass. Preview narrows only + chip tracks preview.`);
