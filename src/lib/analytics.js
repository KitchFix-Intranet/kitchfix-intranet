// Analytics teardown stub — PR 3/3.
//
// PR 1 deleted the dashboard/cron/API surface. PR 2 stripped 30+ callsites
// from 8 route files. This stub remains only because src/lib/auth.js and
// src/app/api/cron/incident-reminders/route.js still import logEventSA, and
// touching those files is out of scope (auth.js is in the danger zone;
// incident-reminders is in its post-incident-feature stabilization window).
//
// When both are safe to edit, delete this file entirely and remove the
// imports from those two callers.

export async function logEventSA() {}
