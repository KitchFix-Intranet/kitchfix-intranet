// /api/kpi/labor/views/[id]
//
// PATCH  update a saved view (only its owner may update)
// DELETE remove a saved view (only its owner may delete)
//
// Server-gated via OPS_LEADERSHIP_EMAILS. The owner check is a second
// gate on top of the allowlist so that shared views cannot be edited
// by other allowlisted users.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
// KPI PREVIEW FENCE - single source of truth in roleGate.js. Sits in
// FRONT of the OPS_LEADERSHIP_EMAILS check on both GET and PUT so a
// fenced caller cannot read or update a saved-view record while the
// labor board is closed to non-Kevin sessions.
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "@/lib/kpi/roleGate";
import { getServiceClient } from "@/lib/supabase";

// Range PR-2 2026-08-24: last_13wk retired. See sibling route.js
// for the migration reference.
// 2026-09-02: last_4wk retired platform-wide. See sibling route.js.
const VALID_PRESETS = new Set(["this_period", "last_period", "fytd"]);

function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validatePatch(body) {
  const errs = [];
  if (!body || typeof body !== "object") return ["body must be a JSON object"];
  if ("name" in body) {
    const n = String(body.name || "").trim();
    if (n.length < 1 || n.length > 80) errs.push("name must be 1-80 chars");
  }
  if ("date_mode" in body && body.date_mode !== "preset" && body.date_mode !== "absolute") {
    errs.push("date_mode must be 'preset' or 'absolute'");
  }
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
  if ("worker_ids" in body && body.worker_ids != null) {
    if (!Array.isArray(body.worker_ids)) errs.push("worker_ids must be null or an array of strings");
    else if (body.worker_ids.some(x => typeof x !== "string")) errs.push("worker_ids must contain strings only");
  }
  if ("redact" in body && typeof body.redact !== "boolean") errs.push("redact must be a boolean");
  if ("is_shared" in body && typeof body.is_shared !== "boolean") errs.push("is_shared must be a boolean");
  return errs;
}

function shape(row, myEmail) {
  return {
    id: row.id, name: row.name, account_key: row.account_key, tab: row.tab,
    date_mode: row.date_mode, date_preset: row.date_preset, date_from: row.date_from, date_to: row.date_to,
    worker_ids: row.worker_ids, redact: !!row.redact, is_shared: !!row.is_shared,
    owner_email: row.owner_email, is_owner: row.owner_email === myEmail,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function safeError(scope, err) {
  console.error(`[kpi/labor/views/id] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

async function requireOwner(supa, id, myEmail) {
  const { data, error } = await supa.from("kpi_saved_views").select("*").eq("id", id).maybeSingle();
  if (error) return { status: 500, err: safeError("lookup", error) };
  if (!data)  return { status: 404, err: { error: "not_found" } };
  if (data.owner_email !== myEmail) return { status: 403, err: { error: "not_owner" } };
  return { row: data };
}

export async function PATCH(request, { params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  // KPI PREVIEW FENCE - refuse before the legacy admin gate.
  if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const idNum = parseInt(id, 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const errs = validatePatch(body);
  if (errs.length) return NextResponse.json({ error: "validation_failed", detail: errs }, { status: 400 });

  const supa = getServiceClient();
  const guard = await requireOwner(supa, idNum, email);
  if (guard.err) return NextResponse.json(guard.err, { status: guard.status });

  const update = {};
  if ("name"        in body) update.name = String(body.name).trim();
  if ("date_mode"   in body) update.date_mode = body.date_mode;
  if ("date_preset" in body) update.date_preset = body.date_mode === "preset" ? body.date_preset : null;
  if ("date_from"   in body) update.date_from   = body.date_mode === "absolute" ? body.date_from : null;
  if ("date_to"     in body) update.date_to     = body.date_mode === "absolute" ? body.date_to   : null;
  if ("worker_ids"  in body) update.worker_ids  = body.worker_ids == null ? null : body.worker_ids;
  if ("redact"      in body) update.redact      = !!body.redact;
  if ("is_shared"   in body) update.is_shared   = !!body.is_shared;

  // B7 optimistic concurrency: if the client passed the timestamp it
  // opened with, refuse when the row has moved on since. Race-safe
  // because we compare against the guard.row we just fetched under
  // the same session context. If not passed, the check is skipped
  // (backwards-compatible with clients that don't yet send it).
  if ("expected_updated_at" in body && body.expected_updated_at) {
    const server = guard.row?.updated_at;
    if (server && String(server) !== String(body.expected_updated_at)) {
      return NextResponse.json({
        error: "This view changed since you opened it - reload to see the current version, or save yours as new.",
        code: "stale_write",
      }, { status: 409 });
    }
  }

  const { data, error } = await supa
    .from("kpi_saved_views")
    .update(update)
    .eq("id", idNum)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "name_conflict" }, { status: 409 });
    return NextResponse.json(safeError("update", error), { status: 500 });
  }
  return NextResponse.json({ ok: true, view: shape(data, email) });
}

export async function DELETE(request, { params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  // KPI PREVIEW FENCE - refuse before the legacy admin gate.
  if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const idNum = parseInt(id, 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const supa = getServiceClient();
  const guard = await requireOwner(supa, idNum, email);
  if (guard.err) return NextResponse.json(guard.err, { status: guard.status });

  const { error } = await supa.from("kpi_saved_views").delete().eq("id", idNum);
  if (error) return NextResponse.json(safeError("delete", error), { status: 500 });
  return NextResponse.json({ ok: true });
}
