// GET /api/ops/inventory-export-full?account=STL-MO&since=YYYY-MM-DD
//
// Full-picture inventory count sheet. Merges the current PG catalog
// with unreconciled ai_line_items at export time (no writes).
//
// Companion to /api/ops/inventory-export-emergency (PR #614), which
// stays as a pure catalog-only fallback. Both routes share the same
// admin allowlist. See docs/SPEC_full-inventory-export.md.
//
// URL account param is normalized to the schema's spaced form:
//   STL-MO -> "STL - MO"
//   TXR-TX-H -> "TXR - TX - H"
//   CORP -> "CORP"
// If the caller sent the spaced form directly we hand it back unchanged.
//
// `since` defaults to 2026-06-04 (the day after the last cron write to
// PG). Callers can widen or narrow the unprocessed-line-items window.

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildFullInventoryCountWorkbook } from "@/lib/inventoryExportFull";

const ADMIN_USERS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"];
const DEFAULT_SINCE = "2026-06-04";

export const dynamic = "force-dynamic";

function normalizeAccountKey(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (s === "CORP") return s;
  if (/ - /.test(s)) return s.toUpperCase();
  return s
    .toUpperCase()
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" - ");
}

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }
  if (!ADMIN_USERS.includes(session.user.email)) {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const rawAccount = searchParams.get("account");
  if (!rawAccount) {
    return NextResponse.json(
      { success: false, error: "account param required (e.g. ?account=STL-MO)" },
      { status: 400 },
    );
  }
  const account = normalizeAccountKey(rawAccount);
  const since = searchParams.get("since") || DEFAULT_SINCE;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json(
      { success: false, error: `since must be YYYY-MM-DD (got ${since})` },
      { status: 400 },
    );
  }

  try {
    const { workbook, filename, stats } = await buildFullInventoryCountWorkbook({ account, since });
    console.log(`[inventory-export-full] account=${account} since=${since} stats=${JSON.stringify(stats)}`);
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
    console.error(`[inventory-export-full] account=${account} error:`, err?.message);
    return NextResponse.json(
      { success: false, error: err?.message || "Export failed" },
      { status: 500 },
    );
  }
}
