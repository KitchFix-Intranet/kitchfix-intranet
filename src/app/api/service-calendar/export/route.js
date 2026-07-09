import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildScWorkbook } from "@/lib/export/scWorkbook";

// GET /api/service-calendar/export
//
// Query params:
//   account (required)  - canonical spaced form, e.g. "CIN - AZ"
//   scope   (required)  - "period" | "month" | "year"
//   year    (required)  - "YYYY"
//   period              - required when scope=period; "7" or "P7"
//   month               - required when scope=month;  "YYYY-MM"
//
// Session auth: 401 JSON when the caller has no session (Q2 ruling:
// all authenticated operators may export the full workbook; no admin
// gate). Errors return JSON + non-200 - the browser must never receive
// a broken .xlsx download.

export const dynamic = "force-dynamic";

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
    const { workbook, filename } = await buildScWorkbook({
      accountKey, scope, year: Number(yearParam), period, month, generatedBy,
    });

    // Serialize to a Buffer via exceljs so we can send Content-Length
    // and let Next handle the response body.
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
    const message = err?.message || "Export failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
