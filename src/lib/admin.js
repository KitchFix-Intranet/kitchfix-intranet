/**
 * Single source of truth for ops leadership / admin email gating.
 * Used across the ops route, invoice handlers, and vendor handlers.
 */
export const OPS_LEADERSHIP_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
];

/**
 * Service Calendar admin gate. Tighter than OPS_LEADERSHIP because
 * SC config edits (price changes, service deactivation) move money;
 * the gate stays restrictive until the v1 site-lead rollout settles.
 *
 * Three call sites today (all in src/app/service-calendar/):
 *   - page.js                  page-level gate (Coming Soon screen)
 *   - ServiceConfig.js         admin editor vs request form
 *   - api/service-calendar/    server-side gate on config-update and config-add
 */
export const SC_ADMINS = [
  "k.fietek@kitchfix.com",
  "joe@kitchfix.com",
];
