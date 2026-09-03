// ═══════════════════════════════════════════════════════════════════
// /api/cron/sc-chase - hourly N3.1/N3.2/N3.3 chase resolver.
// PR-G of the SC -> QBO billing arc (2026-08-14).
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A5 (test/live),
// §A6 (matrix), §A6b (Slack channel). Fired hourly on the hour by
// Vercel Cron. For each per-meal account (perMealAccounts.js), the
// handler resolves "is it a fire moment right now in this account's
// local timezone?" and if so, checks suppression + idempotency and
// calls fireN3.
//
// ─── Cron schedule ────────────────────────────────────────────────
//
// vercel.json entry (PROPOSED, not yet added - owner reviews +
// applies to danger-zone file):
//   { "path": "/api/cron/sc-chase", "schedule": "0 * * * *" }
//
// ─── Auth ─────────────────────────────────────────────────────────
//
// Vercel cron sends Bearer CRON_SECRET. Same pattern as the six
// existing cron routes.
//
// ─── The resolver logic ──────────────────────────────────────────
//
// For each per-meal account:
//   1. Load tz + region from accounts (Postgres, sc-16 shape).
//   2. Load qbo_mode + cadence + salaried_manager_emails + rdo_email
//      from sc_qbo_account_map.
//   3. Derive "now in local tz" -> { dayOfWeekLocal, hourLocal }.
//   4. Match against the schedule:
//        N3.1 Fri 12:00 local -> chase THIS week (Mon at or before today)
//        N3.2 Mon 12:00 local -> chase LAST week (Mon of prior week)
//        N3.3 Tue 09:00 local -> chase LAST week (Mon of prior week)
//   5. Biweekly semantics: N3.2/N3.3 skip if last week's pair-role
//      is 'first' (a first-week cannot be finalized alone; the pair
//      closes with next week). N3.1 fires on both first + close.
//   6. Suppression: skip if the target week has a live sc_week_finalize
//      row (status != 'reverted'). For biweekly first-weeks (N3.1
//      case), also check the partner's live row.
//   7. Idempotency: INSERT sc_week_chase_sent ... ON CONFLICT DO
//      NOTHING. If 0 rows inserted, another cron already fired this
//      stage/week - skip.
//   8. RDO derivation: if sc_qbo_account_map.rdo_email is NULL,
//      derive from accounts.region -> REGIONAL_DIRECTORS. If the
//      region is CORP or missing, no RDO cc (graceful skip).
//   9. Call fireN3.
//  10. UPDATE the sc_week_chase_sent row with email_result + slack_ok.
//
// ─── Fee + MLB gate ──────────────────────────────────────────────
//
// The handler enumerates PER_MEAL_BILLING_ACCOUNTS explicitly. Fee
// (STL - FL) and MLB (CIN - OH, STL - MO, TXR - TX - H/V) accounts
// are structurally absent from that set - they cannot be chased.

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { PER_MEAL_BILLING_ACCOUNTS } from "@/app/service-calendar/v2/billing/perMealAccounts";
import { computeWeekCompleteness, mondayOfWeek, weekDates } from "@/lib/scWeekFinalize";
import { REGIONAL_DIRECTORS } from "@/lib/incidentSchema";
import { NOTIFICATION_TYPES } from "@/lib/billing/recipients";
import { fireN3 } from "@/lib/billing/chaseNotifications";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

// ─── Time helpers ────────────────────────────────────────────────
//
// Vercel cron fires in UTC; account local time is derived via Intl.
// Weekday + hour extracted with a formatter keyed on the account's
// IANA tz.
//
// Returns { dayName, hour24, isoDateLocal } where dayName is one
// of "Monday".."Sunday" and hour24 is 0-23.

function localMoment(nowUtc, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday:  "long",
    hour:     "2-digit",
    hour12:   false,
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  }).formatToParts(nowUtc);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const dayName = get("weekday");
  let hour24 = Number(get("hour"));
  if (Number.isNaN(hour24)) hour24 = -1;
  // Intl's hourCycle can emit "24" for midnight under hour12:false.
  if (hour24 === 24) hour24 = 0;
  const isoDateLocal = `${get("year")}-${get("month")}-${get("day")}`;
  return { dayName, hour24, isoDateLocal };
}

// Given "today in local tz" as an ISO date, return the Monday of THAT
// week (Mon-Sun containing that date).
function mondayOfLocalDate(isoDateLocal) {
  return mondayOfWeek(isoDateLocal);
}

// Monday of the week immediately before the one containing isoDateLocal.
function mondayOfPriorLocalWeek(isoDateLocal) {
  const thisMonday = mondayOfLocalDate(isoDateLocal);
  const d = new Date(`${thisMonday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// ─── Pair-role derivation for biweekly accounts ──────────────────
//
// Mirrors the derivation at src/app/api/service-calendar/route.js:683-716
// (PR-E). weekLabel comes from sc_day_metadata.week_label, shape
// "Week 1".."Week 4". Weeks 1 + 3 are 'first'; weeks 2 + 4 are 'close'.
// Non-biweekly returns 'solo'.

function parseWeekIdx(label) {
  if (typeof label !== "string") return null;
  const m = label.match(/^Week\s+(\d+)$/i);
  return m ? Number(m[1]) : null;
}

async function pairRoleFor(supa, accountKey, monday, cadence) {
  if (cadence !== "biweekly") return { pairRole: "solo", partnerMonday: null, weekIdx: null };
  const { data, error } = await supa
    .from("sc_day_metadata")
    .select("week_label")
    .eq("account_key", accountKey)
    .eq("service_date", monday)
    .maybeSingle();
  if (error) throw new Error(`pairRoleFor(${accountKey}, ${monday}): ${error.message}`);
  const weekIdx = parseWeekIdx(data?.week_label);
  if (weekIdx === 1 || weekIdx === 3) {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return { pairRole: "first", partnerMonday: d.toISOString().slice(0, 10), weekIdx };
  }
  if (weekIdx === 2 || weekIdx === 4) {
    const d = new Date(`${monday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return { pairRole: "close", partnerMonday: d.toISOString().slice(0, 10), weekIdx };
  }
  return { pairRole: "solo", partnerMonday: null, weekIdx: null };
}

// ─── Suppression: does a live finalize row exist for this week? ──

async function isWeekFinalized(supa, accountKey, weekStart) {
  const { data, error } = await supa
    .from("sc_week_finalize")
    .select("id")
    .eq("account_key", accountKey)
    .eq("week_start", weekStart)
    .neq("status", "reverted")
    .maybeSingle();
  if (error) throw new Error(`isWeekFinalized(${accountKey}, ${weekStart}): ${error.message}`);
  return !!data;
}

// ─── Site-lead name lookup for N3.3 Slack payload ────────────────

async function siteLeadNamesFor(supa, salariedEmails) {
  if (!Array.isArray(salariedEmails) || salariedEmails.length === 0) return [];
  const emails = salariedEmails.map(e => String(e).toLowerCase());
  const { data, error } = await supa
    .from("contacts")
    .select("name, email")
    .in("email", emails);
  if (error) return [];
  return (data || []).map(r => r.name).filter(Boolean);
}

// ─── Fire-window matcher ─────────────────────────────────────────
//
// Returns the stage to fire this hour, or null. Hours are compared
// exactly (a cron fires on the 0th minute; a stage window is one hour
// wide). If a future need arises to fire off-the-hour, widen this
// check.

function stageForLocalMoment({ dayName, hour24 }) {
  if (dayName === "Friday"  && hour24 === 12) return NOTIFICATION_TYPES.N3_1;
  if (dayName === "Monday"  && hour24 === 12) return NOTIFICATION_TYPES.N3_2;
  if (dayName === "Tuesday" && hour24 === 9)  return NOTIFICATION_TYPES.N3_3;
  return null;
}

// Which week does this stage target (relative to now in local tz)?
function targetMondayFor(stage, isoDateLocal) {
  if (stage === NOTIFICATION_TYPES.N3_1) return mondayOfLocalDate(isoDateLocal);
  return mondayOfPriorLocalWeek(isoDateLocal);
}

// ─── Deep-link builder ───────────────────────────────────────────
//
// The chase emails link to the account's month view for the target
// week. Uses NEXT_PUBLIC_BASE_URL like the sousai crons do; when
// unset the link falls back to the relative path and Gmail still
// resolves it on-hover if the base host is knowable from the
// recipient's client. Empty string is safer than a wrong absolute.

function scWeekLinkFor(accountKey, weekStart) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const month = weekStart.slice(0, 7);
  const qs = new URLSearchParams({ account: accountKey, month });
  qs.set("day", weekStart);
  return `${base}/service-calendar?${qs.toString()}`;
}

// ─── Acceptance matrix (dev-facing render) ───────────────────────
//
// Auth-gated (same Bearer CRON_SECRET as the main handler). Iterates
// both pilots x N3.1/N3.2/N3.3 with fireN3(send=false), plus an
// empty-salaried live-mode probe for G7. Returns everything the
// acceptance battery needs without touching the ledger or dispatching
// any email.

async function acceptanceMatrix(request) {
  const supa = getServiceClient();
  const url  = new URL(request.url);
  // ?target_week=YYYY-MM-DD (a Monday) lets a caller pin the acceptance
  // matrix to a specific historical week. Used to prove the 6- vs
  // 7-service-day denominator on live pilot data.
  const forcedTargetWeek = url.searchParams.get("target_week");
  const PILOTS = ["TXR - AZ", "CIN - AZ"];
  const STAGES = [NOTIFICATION_TYPES.N3_1, NOTIFICATION_TYPES.N3_2, NOTIFICATION_TYPES.N3_3];

  async function ctxOf(accountKey) {
    const [acc, map] = await Promise.all([
      supa.from("accounts").select("team_key, timezone, region").eq("team_key", accountKey).maybeSingle(),
      supa.from("sc_qbo_account_map").select("account_key, qbo_mode, cadence, salaried_manager_emails, rdo_email").eq("account_key", accountKey).maybeSingle(),
    ]);
    const rdoDerived = REGIONAL_DIRECTORS[acc.data?.region] || null;
    return {
      tz:       acc.data?.timezone,
      region:   acc.data?.region,
      qboMode:  map.data?.qbo_mode,
      cadence:  map.data?.cadence,
      salaried: map.data?.salaried_manager_emails || [],
      rdoEmail: map.data?.rdo_email || rdoDerived || null,
    };
  }

  async function targetOf(accountKey) {
    const today = forcedTargetWeek || new Date().toISOString().slice(0, 10);
    const monday = mondayOfWeek(today);
    const dates = weekDates(monday);
    const comp = await computeWeekCompleteness(accountKey, monday);
    return {
      weekStart: monday, weekEnd: dates[6],
      total:    comp.serviceDays,          // service days only (PR-G1)
      complete: comp.serviceDaysEntered,
      missing:  comp.missingDates || [],
    };
  }

  const perPilot = [];
  for (const account of PILOTS) {
    const ctx = await ctxOf(account);
    const target = await targetOf(account);
    const perStage = [];
    for (const stage of STAGES) {
      const res = await fireN3({
        stage, qboMode: ctx.qboMode, accountKey: account,
        weekStart: target.weekStart, weekEnd: target.weekEnd,
        complete: target.complete, total: target.total, missingDates: target.missing,
        scWeekLink: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/service-calendar?account=${encodeURIComponent(account)}&month=${target.weekStart.slice(0,7)}&day=${target.weekStart}`,
        accountMap: { salariedManagerEmails: ctx.salaried, rdoEmail: ctx.rdoEmail },
        siteLeadNames: [],
        send: false,
      });
      perStage.push({
        stage,
        subject: res.subject,
        preheader: res.preheader,
        recipients: res.recipients,
        htmlLength: res.html.length,
        htmlHead: res.html.slice(0, 200),
        // PR-G1 (2026-08-17): full HTML available on ?full_html=1 so
        // template polish assertions can grep for token values.
        html: url.searchParams.get("full_html") === "1" ? res.html : undefined,
        slack: res.slack ? { text: res.slack.text } : null,
        noSiteRecipient: res.noSiteRecipient,
      });
    }
    perPilot.push({ account, ctx, target, stages: perStage });
  }

  // G7 live-mode empty salaried on TXR - AZ.
  const target = await targetOf("TXR - AZ");
  const emptyLive = await fireN3({
    stage: NOTIFICATION_TYPES.N3_1, qboMode: "live",
    accountKey: "TXR - AZ",
    weekStart: target.weekStart, weekEnd: target.weekEnd,
    complete: target.complete, total: target.total, missingDates: target.missing,
    scWeekLink: "http://localhost:3000/",
    accountMap: { salariedManagerEmails: [], rdoEmail: "r.moore@kitchfix.com" },
    send: false,
  });

  return NextResponse.json({
    ok: true,
    perPilot,
    g7: {
      subject: emptyLive.subject,
      recipients: emptyLive.recipients,
      noSiteRecipient: emptyLive.noSiteRecipient,
      bodyHasNote: emptyLive.html.includes("No site recipient is configured"),
    },
    per_meal_set: [...PER_MEAL_BILLING_ACCOUNTS],
  });
}

// ─── The handler ─────────────────────────────────────────────────

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url0 = new URL(request.url);
  // Acceptance render mode: skips fire-window + ledger, iterates the
  // full pilot x stage matrix with send=false. Emits the raw fireN3
  // shapes so the G2/G3/G5/G7/G8/G9 assertions can run against real
  // data without dispatching mail. Query param, auth-gated.
  if (url0.searchParams.get("assert") === "full") {
    return acceptanceMatrix(request);
  }

  const nowUtc = new Date();
  const supa = getServiceClient();
  const log = [];
  const results = [];

  // A URL override lets a test/debug caller inject a specific "now"
  // to prove the resolver without waiting for the wall clock. The
  // Bearer check above already gates access; ?now=YYYY-MM-DDTHH:MM:SSZ
  // is honored only when the request is authorized.
  const url = new URL(request.url);
  const nowOverride = url.searchParams.get("now");
  const effectiveNow = nowOverride ? new Date(nowOverride) : nowUtc;
  if (nowOverride && !Number.isFinite(effectiveNow.getTime())) {
    return NextResponse.json({ error: `bad ?now: ${nowOverride}` }, { status: 400 });
  }
  const dryRun = url.searchParams.get("dry_run") === "1";
  const forcedAccount = url.searchParams.get("account"); // scoped-run for probes

  // Pull accounts (tz + region) + sc_qbo_account_map in one batch per
  // per-meal account so the resolver runs on real data.
  const perMealList = [...PER_MEAL_BILLING_ACCOUNTS]
    .filter(k => !forcedAccount || k === forcedAccount);

  const [accountsRes, mapRes] = await Promise.all([
    supa.from("accounts").select("team_key, timezone, region").in("team_key", perMealList),
    supa.from("sc_qbo_account_map")
      .select("account_key, qbo_mode, cadence, salaried_manager_emails, rdo_email")
      .in("account_key", perMealList),
  ]);
  if (accountsRes.error) return NextResponse.json({ ok: false, phase: "accounts", error: accountsRes.error.message }, { status: 500 });
  if (mapRes.error)      return NextResponse.json({ ok: false, phase: "sc_qbo_account_map", error: mapRes.error.message }, { status: 500 });

  const accountsByKey = new Map((accountsRes.data || []).map(r => [r.team_key, r]));
  const mapByKey      = new Map((mapRes.data      || []).map(r => [r.account_key, r]));

  for (const accountKey of perMealList) {
    const acc = accountsByKey.get(accountKey);
    const map = mapByKey.get(accountKey);
    if (!acc || !map) {
      log.push(`${accountKey}: skip - missing accounts row or sc_qbo_account_map row`);
      continue;
    }
    const tz = acc.timezone || null;
    if (!tz) {
      log.push(`${accountKey}: skip - accounts.timezone is null`);
      continue;
    }

    const moment = localMoment(effectiveNow, tz);
    const stage  = stageForLocalMoment(moment);
    if (!stage) {
      log.push(`${accountKey}: no-fire (${moment.dayName} ${moment.hour24}:00 ${tz})`);
      continue;
    }

    const weekStart = targetMondayFor(stage, moment.isoDateLocal);
    const dates     = weekDates(weekStart);
    const weekEnd   = dates[6];

    // Cadence + pair-role check for biweekly.
    const pair = await pairRoleFor(supa, accountKey, weekStart, map.cadence);
    if (
      map.cadence === "biweekly"
      && (stage === NOTIFICATION_TYPES.N3_2 || stage === NOTIFICATION_TYPES.N3_3)
      && pair.pairRole !== "close"
    ) {
      log.push(`${accountKey}: ${stage} skip - biweekly week ${weekStart} is not the close-week (role=${pair.pairRole})`);
      continue;
    }

    // Suppression - target week already finalized.
    const finalized = await isWeekFinalized(supa, accountKey, weekStart);
    if (finalized) {
      log.push(`${accountKey}: ${stage} skip - week ${weekStart} is already finalized`);
      continue;
    }
    // Biweekly first-week (N3.1 only): partner already finalized closes the pair.
    if (map.cadence === "biweekly" && stage === NOTIFICATION_TYPES.N3_1 && pair.pairRole === "first" && pair.partnerMonday) {
      const partnerFinalized = await isWeekFinalized(supa, accountKey, pair.partnerMonday);
      if (partnerFinalized) {
        log.push(`${accountKey}: N3.1 skip - biweekly first-week ${weekStart} has partner ${pair.partnerMonday} already finalized`);
        continue;
      }
    }

    // Completeness for the target week. serviceDays + serviceDaysEntered
    // are server-authoritative from computeWeekCompleteness (extended
    // PR-G1) - the denominator MUST match what the finalize control
    // will show, otherwise the chase overstates the shortfall (see
    // the 2026-08-17 report: "1 of 7" was wrong for TXR - AZ because
    // Sunday is planned-off; correct is "1 of 6").
    let comp;
    try {
      comp = await computeWeekCompleteness(accountKey, weekStart);
    } catch (e) {
      log.push(`${accountKey}: ${stage} skip - completeness failed: ${e.message || e}`);
      continue;
    }
    const missing  = comp.missingDates || [];
    const total    = comp.serviceDays;              // service days only
    const complete = comp.serviceDaysEntered;       // service days with actuals

    // RDO auto-derive with override. accountMap.rdo_email wins when
    // non-null; else region -> REGIONAL_DIRECTORS (null for CORP or
    // an unknown region, which surfaces gracefully as no RDO cc).
    const rdoDerived = REGIONAL_DIRECTORS[acc.region] || null;
    const rdoEmail   = map.rdo_email || rdoDerived || null;

    // Idempotency: INSERT the ledger row BEFORE send. UNIQUE index
    // catches duplicates; if RETURNING is empty, another cron worker
    // already claimed this send - skip.
    const isTest = map.qbo_mode === "test";
    if (dryRun) {
      log.push(`${accountKey}: ${stage} DRY-RUN would send to ${JSON.stringify({ to_len: (isTest ? 1 : (map.salaried_manager_emails || []).length), cc_len: 2 + (rdoEmail && stage === NOTIFICATION_TYPES.N3_3 ? 1 : 0) })}`);
      results.push({ accountKey, stage, weekStart, dryRun: true, moment, complete, total, missingCount: missing.length, isTest, rdoEmail });
      continue;
    }
    const insertRes = await supa
      .from("sc_week_chase_sent")
      .insert({
        account_key:    accountKey,
        week_start:     weekStart,
        stage,
        recipients_to:  [],
        recipients_cc:  [],
        is_test:        isTest,
        // 2026-09-03: all three chase stages now post to Slack (was
        // N3.3 only). Initialize slack_ok = false for every stage;
        // the post-send UPDATE stamps the actual outcome.
        slack_ok:       false,
      })
      .select("id")
      .maybeSingle();

    if (insertRes.error) {
      // ON CONFLICT is not native to supabase-js .insert; if the code
      // is 23505 (unique_violation) treat as already-sent = skip.
      // Other errors escalate.
      if (String(insertRes.error.code) === "23505") {
        log.push(`${accountKey}: ${stage} skip - ledger row already exists for ${weekStart} (duplicate fire)`);
        continue;
      }
      log.push(`${accountKey}: ${stage} ABORT - ledger insert failed: ${insertRes.error.message}`);
      continue;
    }
    const ledgerId = insertRes.data?.id;

    // Site-lead names for the N3.3 Slack "Site leads:" line. Only
    // needed for that stage; skip the round-trip otherwise.
    let siteLeadNames = [];
    if (stage === NOTIFICATION_TYPES.N3_3) {
      siteLeadNames = await siteLeadNamesFor(supa, map.salaried_manager_emails);
    }

    // fireN3. accountMap shape matches resolveRecipients expectations.
    let fireRes;
    try {
      fireRes = await fireN3({
        stage, qboMode: map.qbo_mode,
        accountKey, weekStart, weekEnd,
        complete, total, missingDates: missing,
        scWeekLink: scWeekLinkFor(accountKey, weekStart),
        accountMap: {
          salariedManagerEmails: map.salaried_manager_emails || [],
          rdoEmail,
        },
        siteLeadNames,
      });
    } catch (e) {
      log.push(`${accountKey}: ${stage} FIRE THREW: ${e.message || e}`);
      // Leave the ledger row so we don't re-fire on this hour; Kevin
      // can DELETE + retry in Studio if needed.
      continue;
    }

    // Post-send: stamp email_result + slack_ok on the ledger row so
    // the audit trail records the outcome. 2026-09-03: slack_ok
    // tracked for all three stages (was N3.3 only).
    const emailResultText = fireRes?.email?.result === "sent" ? "sent" : "failed";
    const slackOk = !!fireRes?.slack?.result?.sent;
    if (ledgerId) {
      const updRes = await supa
        .from("sc_week_chase_sent")
        .update({
          recipients_to: fireRes.recipients.to,
          recipients_cc: fireRes.recipients.cc,
          email_result:  emailResultText,
          slack_ok:      slackOk,
          changed_at:    new Date().toISOString(),
        })
        .eq("id", ledgerId);
      if (updRes.error) {
        log.push(`${accountKey}: ${stage} sent but ledger UPDATE failed: ${updRes.error.message}`);
      }
    }

    log.push(`${accountKey}: ${stage} ${emailResultText} slack=${slackOk} week=${weekStart} to=${fireRes.recipients.to.length} cc=${fireRes.recipients.cc.length}${fireRes.noSiteRecipient ? " NO_SITE_RECIPIENT" : ""}`);
    results.push({
      accountKey, stage, weekStart, complete, total,
      missing, isTest, rdoEmail,
      email: fireRes.email, slack: fireRes.slack,
      noSiteRecipient: fireRes.noSiteRecipient,
    });
  }

  return NextResponse.json({
    ok: true,
    now: effectiveNow.toISOString(),
    dryRun,
    scanned: perMealList.length,
    sent: results.length,
    log,
    results,
  });
}
