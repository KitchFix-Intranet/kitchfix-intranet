// src/lib/kpi/resolveName.js
//
// Canonical name resolver. Rippling's /workers endpoint does NOT
// carry name fields (C3 diagnostic + C5.1 confirmation); names live
// on the /users endpoint. This resolver joins them.
//
// Rules that do not bend:
//   1. Never parse an email. `treestone.finance@x.com` -> "Treestone
//      Finance" is a name Rippling never gave us.
//   2. Never assemble a name from anything but a field Rippling calls
//      the name.
//   3. Return null when no canonical field is populated. The consumer
//      renders `#N` or `#N · Title`; a number is honestly opaque.
//
// Field-preference order matches Rippling's /users response shape
// (confirmed via C5.1 single-call probe):
//   1. user.name.formatted           SCIM-style formatted full name
//   2. user.display_name             what Rippling's UI shows
//   3. user.name.preferred_given_name + preferred_family_name
//   4. user.name.given_name + family_name
//   5. worker.full_name / .name / .first_name+.last_name   (defensive;
//                                    not populated in current ingest,
//                                    kept in case /workers ever starts
//                                    returning them)
// Return null if none produce a non-empty trimmed string.

export function resolveWorkerName(workerPayload, userPayload) {
  const w = workerPayload || {};
  const u = userPayload || {};
  const candidates = [
    u.name?.formatted,
    u.display_name,
    (u.name?.preferred_given_name && u.name?.preferred_family_name)
      ? `${u.name.preferred_given_name} ${u.name.preferred_family_name}`
      : null,
    (u.name?.given_name && u.name?.family_name)
      ? `${u.name.given_name} ${u.name.family_name}`
      : null,
    w.full_name,
    w.name,
    (w.first_name && w.last_name) ? `${w.first_name} ${w.last_name}` : null,
  ];
  for (const c of candidates) {
    if (c && String(c).trim().length > 0) return String(c).trim();
  }
  return null;
}
