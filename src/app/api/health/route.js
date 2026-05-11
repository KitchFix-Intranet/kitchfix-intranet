/**
 * /api/health/route.js
 *
 * Reachability probe for external monitoring (Better Stack / Uptime Robot — Task 10).
 * 200 + {status:"ok", hub_sheet:"reachable"} when the service account can read the HUB sheet.
 * 500 + {status:"error", error:"..."} otherwise (generic message; detail logged server-side).
 * Unauthenticated — must be allow-listed in src/middleware.js.
 */

import { NextResponse } from "next/server";
import { readRangeSA, SHEET_IDS } from "@/lib/sheets";

export const dynamic = "force-dynamic"; // never cache a health check

export async function GET() {
  try {
    const result = await readRangeSA(SHEET_IDS.HUB, "accounts!A1:A1");
    if (!result.success) {
      console.error("[health] HUB read failed:", result.error);
      return NextResponse.json({ status: "error", error: "hub_sheet unreachable" }, { status: 500 });
    }
    return NextResponse.json({ status: "ok", hub_sheet: "reachable" });
  } catch (err) {
    console.error("[health] unexpected error:", err);
    return NextResponse.json({ status: "error", error: "health check failed" }, { status: 500 });
  }
}
