// src/lib/kpi/resolveWorkerMeta.js
//
// V40 BUG 5 - one shared name-resolver for the labor route. Both the
// aggregate path (route.js:~360) and the single-account path
// (route.js:~608) previously inlined the same three-step block: pull
// workers by rippling_id, collect user_ids from their payloads, batch
// users, run resolveWorkerName. Salaried rows were shaped in
// salaryBoard.js without touching either block and their worker_ids
// never made it to the resolver - so at CIN - AZ with salary on the
// table rendered "#61ccf5", "#63b44b", "#686304" instead of names.
//
// Fix posture: extract once, call twice - the hourly path calls it
// with hourly worker ids up front, and the salary merge caller calls
// it with the salary worker ids that were NOT already resolved. A
// future name-resolution fix lands in this one file.
//
// Return shape matches the object route.js used to build inline:
//   { workerMeta, resolvedNames, usersReachable }
// workerMeta is keyed by worker rippling_id. display_name is null when
// the users table has no canonical name, exactly as hourly does.
//
// PII posture: identical to the inline blocks. This helper touches
// name fields only for the response payload; it never logs a name
// or an email.

import { resolveWorkerName } from "./resolveName";
import { fetchAllIn } from "../rippling/paginate";

// 2026-08-28 pagination sweep: both .in() reads now go through
// fetchAllIn. Prior bare .in() failed with 400 Bad Request from URL
// overflow when uniq exceeded ~700 (portfolio ALL queries), and the
// existing early-return-on-error left workerMeta empty - so every
// hourly cell rendered as `#rippling_id` instead of a name. Not
// silent-truncation but the same operator-visible bug shape.
export async function resolveWorkerMeta(supa, workerIds) {
  const workerMeta = {};
  let resolvedNames = 0;
  let usersReachable = false;
  const uniq = [...new Set((workerIds || []).filter(Boolean))];
  if (uniq.length === 0) return { workerMeta, resolvedNames, usersReachable };

  let workerRows;
  try {
    workerRows = await fetchAllIn(supa, "rippling_raw_workers_latest", "payload", {
      keyCol: "rippling_id", keyValues: uniq,
    });
  } catch { return { workerMeta, resolvedNames, usersReachable }; }

  const userIds = [...new Set(workerRows.map(r => r.payload?.user_id).filter(Boolean))];
  const userByRipplingId = new Map();
  if (userIds.length > 0) {
    let userRows;
    try {
      userRows = await fetchAllIn(supa, "rippling_raw_users_latest", "rippling_id, payload", {
        keyCol: "rippling_id", keyValues: userIds,
      });
      usersReachable = true;
    } catch { userRows = []; }
    for (const r of userRows) userByRipplingId.set(r.rippling_id, r.payload || {});
  }

  for (const r of workerRows) {
    const p = r.payload || {};
    const userPayload = p.user_id ? userByRipplingId.get(p.user_id) : null;
    const title = p.title ? String(p.title).trim() : null;
    const name = resolveWorkerName(p, userPayload);
    if (name) resolvedNames++;
    workerMeta[p.id] = {
      worker_id: p.id,
      number: p.number ?? null,
      display_name: name,
      title,
      status: p.status || null,
    };
  }

  return { workerMeta, resolvedNames, usersReachable };
}
