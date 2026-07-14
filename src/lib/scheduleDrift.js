// ══════════════════════════════════════════════════════════════════════
// Schedule-drift watchdog (Stage 1)
// ══════════════════════════════════════════════════════════════════════
//
// Kevin's ruling (2026-07-14): the MLB / MiLB Stats API is calendar
// truth for every schedule-bearing account (see docs/modules/
// SERVICE_CALENDAR.md "Schedule truth hierarchy"). Stage 1 of the
// drift watchdog DETECTS drift and NOTIFIES Slack. It does NOT modify
// any schedule / projection / metadata table. Applying changes stays
// the manual extract -> migration flow per the doctrine.
//
// Stages 2/3 (auto-draft migration PRs, ON CONFLICT auto-apply) are
// PARKED to 2027 review - see SC_STATUS.md parked-projects.
//
// This module exports:
//   - TRACKED_TEAMS: the 8 schedule-bearing accounts, resolved by NAME
//     via Part 4 §P4.1 (docs/audits/SC_SCHEDULE_TRUTH_AUDIT_2026-07.md).
//   - KNOWN_ISSUES: game_pks + reason + removal condition. Grouped as
//     a single "known gaps" line so night-one doesn't emit ~50 alarms
//     for open items already in the follow-up backlog.
//   - normalizeOpp / ctDate: opp code + timezone helpers (Part 1 grammar).
//   - fetchTeamSchedule: MLB / MiLB API pull for one team.
//   - diffSchedule: PURE differ - unit-testable, no I/O.
//   - formatSlackPayload: Slack Block-Kit builder with truncation.
//   - HEARTBEAT_DOW: which day of week emits the "still watching" line.

// ── Tracked teams (Part 4 §P4.1 name-resolved) ────────────────────────
//
// Verification comment per ID: resolved by querying
//   statsapi.mlb.com/api/v1/teams?sportId=X&season=2026
// and matching each account's affiliate NAME.  Rerun
// scripts/_probe_sc_part4_milb_name_resolve.mjs if any team is
// re-affiliated between seasons.
export const TRACKED_TEAMS = Object.freeze([
  // MLB (sportId 1)
  { account: "CIN - OH",     sportId: 1,  teamId: 113, name: "Cincinnati Reds",      tz: "America/New_York" },
  { account: "STL - MO",     sportId: 1,  teamId: 138, name: "St. Louis Cardinals",  tz: "America/Chicago"  },
  { account: "TXR - TX - H", sportId: 1,  teamId: 140, name: "Texas Rangers (H)",    tz: "America/Chicago"  },
  { account: "TXR - TX - V", sportId: 1,  teamId: 140, name: "Texas Rangers (V)",    tz: "America/Chicago"  },
  // AAA (sportId 11, International League)
  { account: "CIN - KY",     sportId: 11, teamId: 416, name: "Louisville Bats",      tz: "America/New_York" },
  { account: "TBJ - NY",     sportId: 11, teamId: 422, name: "Buffalo Bisons",       tz: "America/New_York" },
  // FSL Single-A (sportId 14, Florida State League)
  { account: "STL - FL",     sportId: 14, teamId: 279, name: "Palm Beach Cardinals", tz: "America/New_York" },
  { account: "TBJ - FL",     sportId: 14, teamId: 424, name: "Dunedin Blue Jays",    tz: "America/New_York" },
]);

// ── Opponent code normalization (Part 1 grammar) ───────────────────────
// MLB Stats API returns AZ / OAK; our DB canonicalizes to ARI / ATH.
const MLB_TO_DB_OPP = new Map([
  ["AZ", "ARI"],
  ["OAK", "ATH"],
]);
export function normalizeOpp(rawAbbr) {
  if (!rawAbbr) return null;
  return MLB_TO_DB_OPP.get(rawAbbr) || rawAbbr;
}

// ── Central-time-ish date extraction ───────────────────────────────────
// Same helper Part 1/3/4 used: convert an ISO UTC gameDate to the venue's
// local YYYY-MM-DD via Intl. The TZ per account matches sc_homestand_
// schedule's service_date convention (venue-local calendar day).
export function localDate(iso, tz) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${day}`;
}

// ── KNOWN_ISSUES: suppression list for open items ──────────────────────
//
// Every entry documents WHY the drift is expected and WHEN the entry
// should be removed. If a game_pk appears here, the differ emits a
// "known gap" tag instead of alarming, and the Slack post groups all
// hits into a single one-liner.
//
// Seeded from Part 4 §P4.2 unreconciled population as of PR-open. As
// the follow-up PRs (sc-19b GUARDED reconcile + Option A) apply, remove
// the corresponding entries.
export const KNOWN_ISSUES = Object.freeze([
  // ── WAIT_OPTION_A: DATE_DRIFT rows whose target date collides
  //     (two-games-one-date, requires Option A game_number + array shape).
  //     Removal: when Option A ships and re-extracts these into their
  //     current API dates.
  //
  //     Initially classified as GUARDED (actuals on either side) in
  //     the sc-19 probe, but Kevin's 2026-07-14 "actuals stay" ruling
  //     re-ordered the classifier so collision blocks first. Every
  //     one of the 12 previously-GUARDED rows also has a target-date
  //     collision - they all need Option A. sc-19b would have been
  //     empty; documented here instead.
  { game_pk: 824518, account: "CIN - OH", reason: "DATE_DRIFT waits Option A (target 2026-05-23 has partner pk=824516)" },
  { game_pk: 824514, account: "CIN - OH", reason: "DATE_DRIFT waits Option A (target 2026-08-17 has partner pk=824478)" },
  { game_pk: 824518, account: "STL - MO", reason: "DATE_DRIFT waits Option A (target 2026-05-23 has partner pk=824516)" },
  { game_pk: 823062, account: "STL - MO", reason: "DATE_DRIFT waits Option A (target 2026-07-07 has partner pk=823035)" },
  { game_pk: 824514, account: "STL - MO", reason: "DATE_DRIFT waits Option A (target 2026-08-17 has partner pk=824478)" },
  { game_pk: 815998, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-04-04 has partner pk=815996)" },
  { game_pk: 815912, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-04-17 has partner pk=815917)" },
  { game_pk: 815840, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-05-01 has partner pk=815841)" },
  { game_pk: 815675, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-05-24 has partner pk=815674)" },
  { game_pk: 816932, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-07-11 has partner pk=816935)" },
  { game_pk: 820655, account: "TBJ - FL", reason: "DATE_DRIFT waits Option A (target 2026-07-11 has partner pk=820651)" },
  // Previously-GUARDED (12 rows). Kevin's actuals-stay ruling lets these
  // move in principle, but every target date has an existing hs row too.
  { game_pk: 816286, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-05-07 has partner pk=816285)" },
  { game_pk: 816276, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-05-17 has partner pk=816275)" },
  { game_pk: 816810, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-05-20 has partner pk=816813)" },
  { game_pk: 816802, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-05-23 has partner pk=816805)" },
  { game_pk: 816638, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-06-17 has partner pk=816637)" },
  { game_pk: 816643, account: "CIN - KY", reason: "DATE_DRIFT waits Option A (target 2026-06-19 has partner pk=816644)" },
  { game_pk: 816975, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-03-29 has partner pk=816972)" },
  { game_pk: 816974, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-04-08 has partner pk=816973)" },
  { game_pk: 816964, account: "TBJ - NY", reason: "DATE_DRIFT waits Option A (target 2026-04-26 has partner pk=816963)" },
  { game_pk: 820419, account: "STL - FL", reason: "DATE_DRIFT waits Option A (target 2026-05-13 has partner pk=820415)" },
  { game_pk: 820698, account: "TBJ - FL", reason: "DATE_DRIFT waits Option A (target 2026-04-04 has partner pk=820696)" },
  { game_pk: 820676, account: "TBJ - FL", reason: "DATE_DRIFT waits Option A (target 2026-05-21 has partner pk=820673)" },

  // ── AAA MISSING_IN_DB DH game-2s (need array shape to insert)
  { game_pk: 816263, account: "CIN - KY", reason: "AAA missing DH game-2 waits Option A (target 2026-07-18 has partner pk=815727)" },
  { game_pk: 816824, account: "TBJ - NY", reason: "AAA missing DH game-2 waits Option A (target 2026-09-12 has partner pk=816825)" },

  // ── Suspended-pk pair (STL - FL 820716 appears on two dates in API)
  { game_pk: 820716, account: "STL - FL", reason: "Suspended game appears on 2 dates (7/12, 8/11); Option A pair semantics needed" },

  // ── PDCO overlay is HOME-only by design (sc-17 / sc-17b). Every FSL
  //     AWAY game will emit MISSING_IN_DB until Kevin widens the overlay
  //     (his standing "keep HOME-only" ruling 2026-07-14 means DO NOT
  //     alarm). Rather than list ~140 pks, the differ has a special
  //     rule: for STL - FL / TBJ - FL, MISSING_IN_DB where API says AWAY
  //     is suppressed as "PDCO_AWAY_BY_DESIGN".
]);

// ── Pure differ ───────────────────────────────────────────────────────
//
// Inputs (all pre-fetched by the caller so the differ is I/O-free and
// unit-testable):
//   apiGames: [{ date, game_pk, ha, opp, status, isPPD, dhCode,
//                gameNumber, gameTimeUtc }]
//   hsRows:   [{ service_date, day_type, opponent, game_pk, game_time }]
//   account:  the account key (used for KNOWN_ISSUES + PDCO suppression)
//
// Output shape:
//   {
//     drifts: [ { kind, account, date, game_pk, details, severity } ],
//     knownGaps: [ { game_pk, reason } ],
//     counts: { drifts, knownGaps, ok, ppd, dh }
//   }
//
// Drift kinds:
//   MISSING_IN_DB, PHANTOM_IN_DB, DATE_DRIFT, ATTRIBUTE_DRIFT,
//   TIME_DELTA, STATUS_CHANGE, NEW_GAME_PK
//
// Severity: "alert" (real drift, post to Slack) | "known" (matched
// KNOWN_ISSUES, grouped into one line) | "ignored" (PDCO AWAY by
// design; not counted).
const TIME_DELTA_TOLERANCE_MIN = 5;  // Part 1 § "COSMETIC_TIME"

export function diffSchedule({ apiGames, hsRows, account }) {
  const drifts = [];
  const knownGaps = [];
  const counts = { drifts: 0, knownGaps: 0, ok: 0, ppd: 0, dh: 0 };

  const knownForAccount = new Set(
    KNOWN_ISSUES.filter(k => k.account === account).map(k => k.game_pk)
  );
  const knownReason = new Map(
    KNOWN_ISSUES.filter(k => k.account === account).map(k => [k.game_pk, k.reason])
  );

  const apiByPk = new Map();
  for (const g of apiGames) apiByPk.set(g.game_pk, g);
  const hsByPk = new Map();
  const hsByDate = new Map();
  for (const r of hsRows) {
    if (r.game_pk != null) hsByPk.set(r.game_pk, r);
    if (!hsByDate.has(r.service_date)) hsByDate.set(r.service_date, []);
    hsByDate.get(r.service_date).push(r);
  }

  const isPDCO = account === "STL - FL" || account === "TBJ - FL";

  // API-side walk
  for (const g of apiGames) {
    if (g.isPPD) counts.ppd++;
    if (g.dhCode && g.dhCode !== "N") counts.dh++;

    const hs = hsByPk.get(g.game_pk);
    if (!hs) {
      // MISSING_IN_DB. Check suppression conditions.
      if (isPDCO && g.ha === "AWAY") {
        // PDCO overlay is HOME-only by design.
        continue;
      }
      if (knownForAccount.has(g.game_pk)) {
        knownGaps.push({ game_pk: g.game_pk, reason: knownReason.get(g.game_pk) });
        counts.knownGaps++;
      } else {
        drifts.push({
          kind: "MISSING_IN_DB", account, date: g.date, game_pk: g.game_pk,
          details: `api=${g.ha}/${g.opp} status="${g.status}" DH=${g.dhCode} game#=${g.gameNumber}`,
          severity: "alert",
        });
        counts.drifts++;
      }
      continue;
    }

    // pk match. Check date + attributes.
    if (hs.service_date !== g.date) {
      if (knownForAccount.has(g.game_pk)) {
        knownGaps.push({ game_pk: g.game_pk, reason: knownReason.get(g.game_pk) });
        counts.knownGaps++;
      } else {
        drifts.push({
          kind: "DATE_DRIFT", account, date: g.date, game_pk: g.game_pk,
          details: `hs.service_date=${hs.service_date} api.date=${g.date} api=${g.ha}/${g.opp}`,
          severity: "alert",
        });
        counts.drifts++;
      }
      continue;
    }

    // Same pk, same date. Check ha + opp + time.
    const expectedDt = g.ha === "HOME" ? "GAME" : "AWAY";
    const haOk = hs.day_type === expectedDt || hs.day_type === "EXHIBITION";
    const oppOk = (hs.opponent || null) === (g.opp || null);
    let attrDrift = null;
    if (!haOk) attrDrift = `H/A: hs=${hs.day_type} api=${g.ha}`;
    else if (!oppOk) attrDrift = `opp: hs=${hs.opponent} api=${g.opp}`;
    if (attrDrift) {
      drifts.push({
        kind: haOk ? "OPP_CHANGE" : "H_A_FLIP",
        account, date: g.date, game_pk: g.game_pk,
        details: attrDrift, severity: "alert",
      });
      counts.drifts++;
      continue;
    }

    // Time delta (only when both sides have a timestamp).
    if (hs.game_time && g.gameTimeUtc) {
      const hsMs = new Date(hs.game_time).getTime();
      const apiMs = new Date(g.gameTimeUtc).getTime();
      const deltaMin = Math.abs(hsMs - apiMs) / 60000;
      if (deltaMin > TIME_DELTA_TOLERANCE_MIN) {
        drifts.push({
          kind: "TIME_DELTA", account, date: g.date, game_pk: g.game_pk,
          details: `hs=${new Date(hs.game_time).toISOString()} api=${g.gameTimeUtc} delta=${Math.round(deltaMin)}min`,
          severity: "alert",
        });
        counts.drifts++;
        continue;
      }
    }

    counts.ok++;
  }

  // DB-side walk (PHANTOM_IN_DB).
  for (const r of hsRows) {
    if (r.game_pk == null) continue;  // e.g. TXR EXHIBITION rows have null pk by design
    if (!apiByPk.has(r.game_pk)) {
      if (knownForAccount.has(r.game_pk)) {
        knownGaps.push({ game_pk: r.game_pk, reason: knownReason.get(r.game_pk) });
        counts.knownGaps++;
      } else {
        drifts.push({
          kind: "PHANTOM_IN_DB", account, date: r.service_date, game_pk: r.game_pk,
          details: `hs=${r.day_type}/${r.opponent} - not in API`,
          severity: "alert",
        });
        counts.drifts++;
      }
    }
  }

  return { drifts, knownGaps, counts };
}

// ── MLB / MiLB API fetch ──────────────────────────────────────────────
//
// One team's regular season (R) + exhibition (E) games for the given
// year. Both gameTypes so the differ can match TXR's sc-12 EXHIBITION
// rows too. Rate: 1 call per account per night = 8 total.
const API_ROOT = "https://statsapi.mlb.com/api/v1/schedule";
export async function fetchTeamSchedule(team, { season = 2026, startDate, endDate } = {}) {
  const start = startDate || `${season}-02-01`;
  const end   = endDate   || `${season}-11-30`;
  const url = `${API_ROOT}?sportId=${team.sportId}&teamId=${team.teamId}&startDate=${start}&endDate=${end}&hydrate=team`;
  const res = await fetch(url, { headers: { "user-agent": "kitchfix-schedule-drift/1" } });
  if (!res.ok) throw new Error(`API ${res.status} on team=${team.account}`);
  const data = await res.json();
  const games = [];
  for (const day of data.dates || []) {
    for (const g of day.games || []) {
      if (g.gameType !== "R" && g.gameType !== "E") continue;
      const home = g.teams?.home?.team;
      const away = g.teams?.away?.team;
      const isHome = home?.id === team.teamId;
      const oppTeam = isHome ? away : home;
      games.push({
        date: localDate(g.gameDate, team.tz),
        game_pk: g.gamePk,
        ha: isHome ? "HOME" : "AWAY",
        opp: normalizeOpp(oppTeam?.abbreviation),
        status: g.status?.detailedState || "",
        isPPD: /Postpone|Suspend|Rescheduled/i.test(g.status?.detailedState || ""),
        dhCode: g.doubleHeader || "N",
        gameNumber: g.gameNumber,
        gameTimeUtc: g.gameDate,
      });
    }
  }
  return games;
}

// ── Slack payload formatter ───────────────────────────────────────────
//
// Kevin's noise discipline (2026-07-14):
//   - Post ONLY on drift (real, unknown alerts) OR failure OR the
//     Monday heartbeat.
//   - Per-account compact lines (`TBJ - FL · 2026-08-14 · time 6:30->7:05 ET`).
//   - Summary counts.
//   - Grouped known-gaps ONE-liner.
//   - Truncate past ~30 drift lines with a "... (N more)" line.

const MAX_LINES = 30;
export const HEARTBEAT_DOW = 1; // 1 = Monday (JS Date.getDay())

function driftLine(d) {
  return `${d.account} · ${d.date} · pk=${d.game_pk} · ${d.kind}: ${d.details}`;
}

export function formatSlackPayload({
  accountResults = [],      // [{ account, counts, drifts, knownGaps, error? }]
  isHeartbeat = false,
  runId = null,
} = {}) {
  const totalDrifts = accountResults.reduce((a, r) => a + (r.drifts?.length || 0), 0);
  const totalKnown  = accountResults.reduce((a, r) => a + (r.knownGaps?.length || 0), 0);
  const failures    = accountResults.filter(r => r.error);
  const okCount     = accountResults.length - failures.length;

  // Silence-is-broken guard - clean run + heartbeat day emits one line.
  if (totalDrifts === 0 && failures.length === 0) {
    if (isHeartbeat) {
      const line = `_schedules clean, ${okCount}/${accountResults.length} accounts checked_`;
      return { shouldPost: true, text: line, blocks: [{ type: "section", text: { type: "mrkdwn", text: `:white_check_mark: ${line}` } }] };
    }
    return { shouldPost: false, text: "", blocks: [] };
  }

  const lines = [];
  const header = failures.length > 0
    ? `:rotating_light: *SC drift watch* - ${totalDrifts} drift${totalDrifts === 1 ? "" : "s"}, ${failures.length} failure${failures.length === 1 ? "" : "s"}`
    : `:warning: *SC drift watch* - ${totalDrifts} drift${totalDrifts === 1 ? "" : "s"} across ${accountResults.filter(r => r.drifts?.length > 0).length} account${accountResults.filter(r => r.drifts?.length > 0).length === 1 ? "" : "s"}`;
  lines.push(header);

  for (const f of failures) {
    lines.push(`✗ ${f.account}: ${f.error}`);
  }

  const allDrifts = accountResults.flatMap(r => r.drifts || []);
  const shown = allDrifts.slice(0, MAX_LINES).map(driftLine);
  for (const s of shown) lines.push(s);
  if (allDrifts.length > MAX_LINES) {
    lines.push(`_... (${allDrifts.length - MAX_LINES} more drift line${allDrifts.length - MAX_LINES === 1 ? "" : "s"} truncated)_`);
  }
  if (totalKnown > 0) {
    const knownAcctCount = new Set(accountResults.filter(r => (r.knownGaps || []).length > 0).map(r => r.account)).size;
    lines.push(`_known gaps: ${totalKnown} match${totalKnown === 1 ? "" : "es"} across ${knownAcctCount} account${knownAcctCount === 1 ? "" : "s"} (Option A backlog)_`);
  }
  if (runId) lines.push(`_run ${runId}_`);

  const text = lines.join("\n");
  return {
    shouldPost: true,
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

export async function postSlack(webhookUrl, payload) {
  if (!webhookUrl) return { posted: false, reason: "no webhook configured" };
  if (!payload.shouldPost) return { posted: false, reason: "clean run, no post per noise discipline" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: payload.text, blocks: payload.blocks }),
    });
    if (!res.ok) return { posted: false, reason: `slack ${res.status}` };
    return { posted: true };
  } catch (e) {
    return { posted: false, reason: `slack fetch failed: ${e.message}` };
  }
}
