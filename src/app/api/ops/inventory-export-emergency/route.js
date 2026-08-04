// GET /api/ops/inventory-export-emergency?account=STL-FL
//
// One-off admin download that pulls the account's inventory catalog
// straight from Postgres and returns a chef-ready Excel count sheet.
// Bypasses the Smart Inventory UI (which is timing out on the STL-FL
// catalog via the AI similarity scanner).
//
// Auth mirrors /api/ops/inventory: session + SI admin allowlist.
// This is a rescue endpoint for STL-FL - other accounts can pass by
// URL but the allowlist keeps it operator-only.
//
// The URL-friendly account key (e.g. "STL-FL") is normalized to the
// canonical spaced form the schema requires ("STL - FL") before the
// PG read.

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildInventoryCountWorkbook } from "@/lib/inventoryExport";

const ADMIN_USERS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"];

export const dynamic = "force-dynamic";

// "STL-FL" -> "STL - FL"; "TXR-TX-H" -> "TXR - TX - H"; "CORP" -> "CORP".
// If the caller already sent the spaced form we hand it back unchanged.
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
      { success: false, error: "account param required (e.g. ?account=STL-FL)" },
      { status: 400 },
    );
  }
  const account = normalizeAccountKey(rawAccount);

  try {
    const { workbook, filename } = await buildInventoryCountWorkbook({ account });
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
    console.error(`[inventory-export-emergency] account=${account} error:`, err?.message);
    return NextResponse.json(
      { success: false, error: err?.message || "Export failed" },
      { status: 500 },
    );
  }
}
