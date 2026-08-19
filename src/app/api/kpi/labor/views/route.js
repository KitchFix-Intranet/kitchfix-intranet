// /api/kpi/labor/views
//
// Saved views for the KPI Labor surface (PR C4).
// Server-gated via OPS_LEADERSHIP_EMAILS - same shape as the read and
// export routes. Without the gate, this endpoint lets anyone
// enumerate what the leadership team is watching.
//
// GET  ?account=X    list views for this user + shared views from
//                    other allowlisted users, scoped to the account
// POST body { ... }  create a view (see body shape below)
//
// (PATCH/DELETE live on ./[id]/route.js)
//
// Body shape (POST):
//   name         string, 1-80 chars
//   account_key  string, must be one of ACCOUNTS
//   tab          "labor" (only tab supported today)
//   date_mode    "preset" | "absolute"
//   date_preset  one of this_period | last_period | last_4wk | last_13wk | fytd  (required when date_mode=preset)
//   date_from    YYYY-MM-DD  (required when date_mode=absolute)
//   date_to      YYYY-MM-DD  (required when date_mode=absolute; must be >= date_from)
//   worker_ids   string[] | null  (null = all workers; empty array = no workers)
//   redact       boolean
//   is_shared    boolean

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
// KPI PREVIEW FENCE - single source of truth in roleGate.js. Sits in
// FRONT of the OPS_LEADERSHIP_EMAILS check on both GET and POST so a
// fenced caller cannot read or write saved-view records while the
// labor board is closed to non-Kevin sessions.
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "@/lib/kpi/roleGate";
import { getServiceClient } from "@/lib/supabase";

const VALID_PRESETS = new Set(["this_period", "last_period", "last_4wk", "last_13wk", "fytd"]);
const VALID_TABS = new Set(["labor"]);

function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validateBody(body) {
  const errs = [];
  if (!body || typeof body !== "object") return ["body must be a JSON object"];
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 80) errs.push("name must be 1-80 chars");
  if (!body.account_key || typeof body.account_key !== "string") errs.push("account_key required");
  const tab = body.tab || "labor";
  if (!VALID_TABS.has(tab)) errs.push(`tab must be one of: ${[...VALID_TABS].join(", ")}`);
  if (body.date_mode !== "preset" && body.date_mode !== "absolute") errs.push("date_mode must be 'preset' or 'absolute'");
  if (body.date_mode === "preset") {
    if (!VALID_PRESETS.has(body.date_preset)) errs.push(`date_preset must be one of: ${[...VALID_PRESETS].join(", ")}`);
    if (body.date_from != null || body.date_to != null) errs.push("date_from/date_to must be null when date_mode='preset'");
  }
  if (body.date_mode === "absolute") {
    if (!isYmd(body.date_from)) errs.push("date_from must be YYYY-MM-DD");
    if (!isYmd(body.date_to))   errs.push("date_to must be YYYY-MM-DD");
    if (isYmd(body.date_from) && isYmd(body.date_to) && body.date_from > body.date_to) errs.push("date_from must be <= date_to");
    if (body.date_preset != null) errs.push("date_preset must be null when date_mode='absolute'");
  }
  if (body.worker_ids != null) {
    if (!Array.isArray(body.worker_ids)) errs.push("worker_ids must be null or an array of strings");
    else if (body.worker_ids.some(x => typeof x !== "string")) errs.push("worker_ids must contain strings only");
  }
  if (typeof body.redact !== "boolean") errs.push("redact must be a boolean");
  if (typeof body.is_shared !== "boolean") errs.push("is_shared must be a boolean");
  return errs;
}

function shape(row, myEmail) {
  return {
    id: row.id,
    name: row.name,
    account_key: row.account_key,
    tab: row.tab,
    date_mode: row.date_mode,
    date_preset: row.date_preset,
    date_from: row.date_from,
    date_to: row.date_to,
    worker_ids: row.worker_ids,
    redact: !!row.redact,
    is_shared: !!row.is_shared,
    owner_email: row.owner_email,
    is_owner: row.owner_email === myEmail,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeError(scope, err) {
  console.error(`[kpi/labor/views] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  // KPI PREVIEW FENCE - refuse before the legacy admin gate.
  if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const account = (searchParams.get("account") || "").trim();

  const supa = getServiceClient();
  let q = supa
    .from("kpi_saved_views")
    .select("*")
    .or(`owner_email.eq.${email},is_shared.eq.true`)
    .order("updated_at", { ascending: false });
  if (account) q = q.eq("account_key", account);
  const { data, error } = await q;
  if (error) return NextResponse.json(safeError("list", error), { status: 500 });

  return NextResponse.json({ ok: true, views: (data || []).map(r => shape(r, email)) });
}

export async function POST(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  // KPI PREVIEW FENCE - refuse before the legacy admin gate.
  if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const errs = validateBody(body);
  if (errs.length) return NextResponse.json({ error: "validation_failed", detail: errs }, { status: 400 });

  const supa = getServiceClient();
  const insert = {
    owner_email: email,
    name: String(body.name).trim(),
    account_key: body.account_key,
    tab: body.tab || "labor",
    date_mode: body.date_mode,
    date_preset: body.date_mode === "preset" ? body.date_preset : null,
    date_from:   body.date_mode === "absolute" ? body.date_from : null,
    date_to:     body.date_mode === "absolute" ? body.date_to   : null,
    worker_ids:  body.worker_ids == null ? null : body.worker_ids,
    redact:      !!body.redact,
    is_shared:   !!body.is_shared,
  };
  const { data, error } = await supa
    .from("kpi_saved_views")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "name_conflict", detail: "You already have a view with that name." }, { status: 409 });
    }
    return NextResponse.json(safeError("insert", error), { status: 500 });
  }
  return NextResponse.json({ ok: true, view: shape(data, email) }, { status: 201 });
}
