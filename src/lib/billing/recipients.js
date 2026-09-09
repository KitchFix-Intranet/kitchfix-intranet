// ═══════════════════════════════════════════════════════════════════
// recipients - the SC billing notification recipient resolver.
// PR-F of the SC -> QBO billing arc (2026-08-13).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5 (test/live)
// + §A6 (matrix). Every billing notification's recipient list comes
// through resolveRecipients - no code path composes recipients any
// other way.
//
// ─── The test-mode override is structural, not conditional ────────
//
// The first branch of resolveRecipients checks mode === 'test' and
// returns Kevin only, immediately. No notification type, no account,
// no argument reaches past that line in test mode. Enforced by the
// F6 grep proof + a matrix test that walks every (notification,
// account) pair.
//
// ─── Live-mode lookups (addendum §A6) ─────────────────────────────
//
// Two per-account lookups feed live-mode resolution:
//   - salariedManagerEmails: TEXT[] read from
//     sc_qbo_account_map.salaried_manager_emails (sc-35). Owner-
//     populated. Empty until Kevin writes the list per addendum §A8
//     principle - the codebase has no authoritative person-level
//     "salaried manager" flag.
//   - rdoEmail: TEXT read from sc_qbo_account_map.rdo_email (sc-35).
//     Owner-populated. NULL until Kevin writes it. When set, joins
//     N3.3 and N4 only (addendum §A6 ruling: RDOs skip N1 so the
//     weekly cadence does not train them to filter the sender).
//
// Both live-mode lookups come in via the accountMap argument so the
// resolver is pure - no DB access here; the finalize caller reads
// accountMap once and threads it through.

// Static-set primary recipients per addendum §A6.
export const KEVIN_EMAIL     = "k.fietek@kitchfix.com";
export const SEBASTIAN_EMAIL = "sebastian@kitchfix.com";
export const JOE_EMAIL       = "joe@kitchfix.com";     // Joe Lessard (VPO), aligned with incidentSchema.js VPO_EMAIL
export const JOSH_EMAIL      = "josh@kitchfix.com";    // Josh Katt (CEO), aligned with incidentSchema.js CEO_EMAIL

// Recognized notification types. Adding one here without a matching
// live-mode branch is a compile-time-esque error (the switch defaults
// to a throw so mistakes surface at first fire, not on Sebastian's
// invoice).
//
// Chase-ladder rebuild 2026-09-09: three stages became two per
// Kevin's ruling to Sebastian (see docs/design/KF_CHASE_EMAILS_RENDER.html
// and the CC_PROMPT_CHASE_REBUILD.md brief).
//   N3.1 (Friday 12:00 reminder) - RETIRED. Kevin dropped the Friday
//     nudge entirely.
//   N3.2 (Monday 12:00 urgent)   - RETIRED, superseded by N3_URGENT
//     with new time + recipients + copy.
//   N3.3 (Tuesday 09:00 past-due) - RETIRED. The Tuesday billing-run
//     concept it named was fiction; no cron actually bills at that
//     time. New shape names real consequences instead.
//   N3_REMINDER (Sunday 18:00 local) - NEW.
//   N3_URGENT   (Monday 15:00 local) - NEW.
//
// Old symbol names retained below as commented notes; do not
// re-export them - a caller passing "N3.1" now hits the switch's
// default throw at first fire, which is the correct failure mode.
export const NOTIFICATION_TYPES = Object.freeze({
  N1:          "N1",             // Invoice ready
  N2:          "N2",             // Push failed
  N3_REMINDER: "N3.reminder",    // Sunday 18:00 local - salaried list, no RDO
  N3_URGENT:   "N3.urgent",      // Monday 15:00 local - salaried + Sebastian + Kevin + RDO
  N4:          "N4",             // Credit needed (+RDO to)
});

// Deduplicate while preserving order + case-folded key so
// "Kevin@Kitchfix.com" and "kevin@kitchfix.com" collapse.
function dedup(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Resolve recipients for a notification, respecting the test-mode
 * structural override.
 *
 * @param {Object} args
 * @param {string} args.notification    One of NOTIFICATION_TYPES values.
 * @param {string} args.accountKey      e.g. "TXR - AZ"
 * @param {"test"|"live"} args.mode     From sc_qbo_account_map.qbo_mode.
 * @param {string} [args.submitterEmail] Site leader who finalized (N1 only).
 * @param {Object} [args.accountMap]     Live-mode lookups.
 * @param {string[]} [args.accountMap.salariedManagerEmails]
 * @param {string|null} [args.accountMap.rdoEmail]
 * @param {string} [args.adjusterEmail] N4 only.
 * @returns {{ to: string[], cc: string[] }}
 */
export function resolveRecipients(args) {
  // ─── FIRST BRANCH: structural test-mode override ────────────────
  // Do not touch args.notification, args.accountKey, or anything else
  // in test mode. Kevin's address, immediately. See docs/SC_QBO_SHAPE_SPEC_
  // ADDENDUM_A.md §A5: "Recipient override is structural, not conditional".
  if (args?.mode === "test") {
    return { to: [KEVIN_EMAIL], cc: [] };
  }

  // Everything below is live-mode. Every path returns a
  // { to, cc } object - the switch's default throws to surface
  // an unknown-notification-type at first fire.
  const notification = args?.notification;
  const submitter = args?.submitterEmail || null;
  const salaried = Array.isArray(args?.accountMap?.salariedManagerEmails)
    ? args.accountMap.salariedManagerEmails
    : [];
  const rdo = args?.accountMap?.rdoEmail || null;

  switch (notification) {
    // N1 Invoice ready: Sebastian, Kevin, Joe, Josh, salaried managers, submitter
    case NOTIFICATION_TYPES.N1: {
      const to = dedup([
        SEBASTIAN_EMAIL, KEVIN_EMAIL, JOE_EMAIL, JOSH_EMAIL,
        ...salaried,
        submitter,
      ]);
      return { to, cc: [] };
    }

    // N2 Push failed: Kevin, Sebastian
    case NOTIFICATION_TYPES.N2: {
      return { to: dedup([KEVIN_EMAIL, SEBASTIAN_EMAIL]), cc: [] };
    }

    // N3.reminder (Sunday 18:00): salaried list only. No RDO on
    // Sunday - Kevin's ruling. An RDO who covers two accounts and
    // gets weekly Sunday emails per account regardless of whether
    // anything is wrong learns to filter the sender. Under this
    // shape, an email from the ladder means something needs their
    // attention. See docs/design/KF_CHASE_EMAILS_RENDER.html.
    case NOTIFICATION_TYPES.N3_REMINDER: {
      return {
        to: dedup(salaried),
        cc: [],
      };
    }

    // N3.urgent (Monday 15:00): salaried list + Sebastian + Kevin +
    // RDO. All primary, no cc split. The prior render suggested a
    // submitter/other-salaried TO/CC split, but that required a
    // submitter distinct from the salaried list which does not
    // exist as a data concept (see Kevin ruling 2026-09-09). One
    // list, one field, no derivation.
    case NOTIFICATION_TYPES.N3_URGENT: {
      return {
        to: dedup([
          ...salaried,
          SEBASTIAN_EMAIL,
          KEVIN_EMAIL,
          rdo,
        ]),
        cc: [],
      };
    }

    // N4 Credit needed: adjuster, Joe, Josh, Sebastian, RDO (to)
    case NOTIFICATION_TYPES.N4: {
      return {
        to: dedup([
          args?.adjusterEmail || null,
          JOE_EMAIL, JOSH_EMAIL, SEBASTIAN_EMAIL, rdo,
        ]),
        cc: [],
      };
    }

    default:
      throw new Error(
        `resolveRecipients: unknown notification type ${JSON.stringify(notification)}. Add it to NOTIFICATION_TYPES + the switch.`
      );
  }
}
