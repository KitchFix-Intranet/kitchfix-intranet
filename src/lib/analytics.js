// Analytics teardown stub - PR 3/3.
//
// PR 1 deleted the dashboard/cron/API surface. PR 2 stripped 30+ callsites
// from 8 route files. This stub remains only because src/lib/auth.js still
// imports logEventSA, and auth.js is in the danger zone.
// (incident-reminders was the other remaining importer and was retired
// 2026-10-16 along with five other crons.)
//
// When auth.js is safe to edit, delete this file entirely and remove the
// import from that caller.

export async function logEventSA() {}
