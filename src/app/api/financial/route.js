/**
 * /api/financial/route.js
 *
 * Financial Dashboard API — currently proxies to /api/ops.
 *
 * MIGRATION PATH:
 *   When ready to split the backend, copy buildPDCContext() and buildLaborContext()
 *   from /api/ops/route.js into this file and point FinancialTool.js at '/api/financial'.
 *   The proxy below requires zero backend work to deploy the new /financial page today.
 *
 * ACTIONS SUPPORTED (forwarded as-is):
 *   GET  labor-bootstrap          → account lists, cross-account summary
 *   GET  labor-bootstrap?account= → single-account KPI data
 *   GET  labor-bootstrap?account=&view=snapshot → reconciliation data
 *   POST submit-labor-plan        → period actuals submission
 */

import { NextResponse } from "next/server";

async function proxyToOps(request) {
  const incoming = new URL(request.url);

  // Build the /api/ops equivalent URL (same origin, different path)
  const opsUrl = new URL("/api/ops", incoming.origin);
  incoming.searchParams.forEach((v, k) => opsUrl.searchParams.set(k, v));

  const init = {
    method:  request.method,
    headers: {
      "Content-Type": "application/json",
      // Forward session cookie so auth check passes
      cookie: request.headers.get("cookie") || "",
    },
  };

  if (request.method === "POST") {
    init.body = await request.text();
  }

  try {
    const resp = await fetch(opsUrl.toString(), init);
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("[financial/route] proxy error:", err);
    return NextResponse.json(
      { success: false, error: "Financial API proxy error" },
      { status: 500 }
    );
  }
}

export async function GET(request)  { return proxyToOps(request); }
export async function POST(request) { return proxyToOps(request); }