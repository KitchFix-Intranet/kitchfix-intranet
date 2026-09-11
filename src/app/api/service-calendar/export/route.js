import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildScExport } from "@/lib/export/scExport";

// GET /api/service-calendar/export
//
// Rebuilt 2026-09-10 (see PR body + docs/design/KF_SC_Export_SAMPLE.xlsx).
// Old 4-sheet Summary/Daily/Notes/Changes shape is replaced with the
// 3-sheet Overview/Projections/Actuals workbook. One export option
// per Kevin's ruling; the menu still passes scope (period|month|year)
// so operators keep the "current view" download muscle memory.
//
// Query params:
//   account (required)  - canonical spaced form, e.g. "CIN - AZ"
//   scope   (required)  - "period" | "month" | "year"
//   year    (required)  - "YYYY"
//   period              - required when scope=period ("7" or "P7")
//   month               - required when scope=month  ("YYYY-MM")
//
// Fee-account refusal (Kevin ruling Item 3 2026-09-10): fee accounts
// (billing_model=flat_fee) have no per-service projected vs actual
// shape; the export is per-meal only. The menu hides the button for
// fee accounts; this endpoint returns 404 + a named reason for any
// URL-typed request that bypasses the menu.
//
// Session auth: 401 JSON when the caller has no session (all
// authenticated operators may export). Errors return JSON + non-200
// so the browser never receives a broken .xlsx download.
//
// maxDuration = 60 covers the largest year-scope build. Baseline
// probe 2026-09-10: TBJ - FL year is ~1.4s in-process; adding HTTP
// + cold-start puts prod comfortably inside the 10s default.

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }
  const generatedBy = session.user?.name || session.user?.email || "unknown";

  const { searchParams } = new URL(request.url);
  const accountKey = searchParams.get("account");
  const scope      = searchParams.get("scope");
  const yearParam  = searchParams.get("year");
  const period     = searchParams.get("period");
  const month      = searchParams.get("month");

  if (!accountKey) {
    return NextResponse.json({ success: false, error: "account param required" }, { status: 400 });
  }
  if (!["period", "month", "year"].includes(scope)) {
    return NextResponse.json({ success: false, error: "scope must be period|month|year" }, { status: 400 });
  }
  if (!yearParam || !/^\d{4}$/.test(yearParam)) {
    return NextResponse.json({ success: false, error: "year param required (YYYY)" }, { status: 400 });
  }
  if (scope === "period" && !period) {
    return NextResponse.json({ success: false, error: "period param required for scope=period" }, { status: 400 });
  }
  if (scope === "month" && (!month || !/^\d{4}-\d{2}$/.test(month))) {
    return NextResponse.json({ success: false, error: "month param required (YYYY-MM) for scope=month" }, { status: 400 });
  }

  try {
    const { workbook, filename } = await buildScExport({
      accountKey, scope, year: Number(yearParam), period, month, generatedBy,
    });

    const buf = await workbook.xlsx.writeBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Fee-account refusal - 404 so browser signals "not available"
    // without triggering the generic 500 error path.
    if (err?.code === "FEE_ACCOUNT_UNSUPPORTED") {
      return NextResponse.json(
        { success: false, error: err.message, code: "FEE_ACCOUNT_UNSUPPORTED" },
        { status: 404 },
      );
    }
    const message = err?.message || "Export failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
