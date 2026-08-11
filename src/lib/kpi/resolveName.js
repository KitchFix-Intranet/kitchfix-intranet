// src/lib/kpi/resolveName.js
//
// Canonical name resolver. Rippling's /workers endpoint does NOT carry
// name fields (C3 diagnostic + C5.1 confirmation); names live on the
// /users endpoint. This resolver joins them.
//
// The goal is matching payroll. `name.formatted` and `display_name`
// both resolve to the PREFERRED name in Rippling, which can drift from
// what shows on the paystub and P&L. This resolver returns the LEGAL
// name (`given_name` + `family_name`) so screen and export tie to the
// financial record.
//
// Field-preference order:
//   1. user.name.given_name + user.name.family_name   the legal name
//   2. user.name.formatted                            only if either
//                                                     legal part is missing
//   3. null                                           consumer falls back
//                                                     to `#N` or `#N · Title`
//
// Middle name is NOT included (Rippling's `formatted` sometimes carries
// a middle; the legal split does not). Payroll records vary on middles
// and inclusion would drift the match.
//
// Rules that do not bend:
//   1. Never parse an email. `treestone.finance@x.com` -> "Treestone
//      Finance" is a name Rippling never gave us.
//   2. Never munge a Rippling-provided string (e.g. dedupe "First
//      First Last" -> "First Last"). If a given_name field itself
//      contains a duplication, that is a Rippling data-quality issue
//      that must be corrected in Rippling, not in the resolver.
//   3. Return null when no canonical field is populated. A number is
//      honestly opaque; a wrong name is confidently wrong.

export function resolveWorkerName(workerPayload, userPayload) {
  const u = userPayload || {};
  const g = u.name?.given_name;
  const f = u.name?.family_name;
  if (g && f && String(g).trim().length > 0 && String(f).trim().length > 0) {
    return `${String(g).trim()} ${String(f).trim()}`;
  }
  const fmt = u.name?.formatted;
  if (fmt && String(fmt).trim().length > 0) return String(fmt).trim();
  return null;
}
