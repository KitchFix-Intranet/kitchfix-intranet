import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  loadMonthPrintData,
  loadPeriodPrintData,
  renderMonthSheet,
  renderPeriodSheetHtml,
} from "@/lib/print/monthSheet";
import { loadSeasonPrintData, renderSeasonSheet } from "@/lib/print/seasonSheet";
import { loadYearPrintData, renderYearSheet } from "@/lib/print/yearSheet";

// SC print - Wave 1 (2026-07-13) + Wave 2 (2026-07-13 Year sheet).
//
// GET /api/service-calendar/print
//
// Query params:
//   account (required)  - canonical spaced form, e.g. "STL - FL"
//   scope   (required)  - "month" | "period" | "season" | "year"
//   year    (required)  - "YYYY"
//   month              - required when scope=month;  "YYYY-MM"
//   period             - required when scope=period; "7" or "P7"
//
// Session auth: 401 JSON when the caller has no session. Same shape as
// the xlsx export at /api/service-calendar/export. Errors return JSON +
// non-200 so the browser never receives a broken .pdf download.
//
// Runtime + timeout are explicit: @sparticuz/chromium requires the
// node runtime (edge cannot spawn a subprocess). maxDuration covers
// cold start (chromium tarball extraction ~2-4s) + render + return.
//
// Filenames are authoritative on the server via Content-Disposition;
// the client's `a.download` attribute is a hint.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const accountKey = searchParams.get("account");
  const scope      = searchParams.get("scope");
  const yearParam  = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const periodParam= searchParams.get("period");

  if (!accountKey) {
    return NextResponse.json({ success: false, error: "account param required" }, { status: 400 });
  }
  if (!["month", "period", "season", "year"].includes(scope)) {
    return NextResponse.json({ success: false, error: "scope must be month|period|season|year" }, { status: 400 });
  }
  if (!yearParam || !/^\d{4}$/.test(yearParam)) {
    return NextResponse.json({ success: false, error: "year param required (YYYY)" }, { status: 400 });
  }
  const year = Number(yearParam);
  if (scope === "month" && (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam))) {
    return NextResponse.json({ success: false, error: "month param required (YYYY-MM) for scope=month" }, { status: 400 });
  }
  if (scope === "period" && !periodParam) {
    return NextResponse.json({ success: false, error: "period param required for scope=period" }, { status: 400 });
  }

  const t0 = Date.now();
  let phase = "load";
  let browser = null;

  try {
    // Build the sheet HTML BEFORE launching chromium. Data errors
    // surface as JSON 500s instead of half-launched browsers.
    let html = "";
    let filenameStem = "";
    // Year sheet ships in portrait; the other three (month, period,
    // season) ship in landscape. Puppeteer's page.pdf() takes an
    // explicit landscape flag - we flip it per scope below.
    let landscape = true;
    if (scope === "month") {
      const ctx = await loadMonthPrintData(accountKey, year, monthParam);
      phase = "render";
      html = renderMonthSheet(ctx);
      filenameStem = buildFilenameStem(accountKey, `${monthParam}`);
    } else if (scope === "period") {
      const ctx = await loadPeriodPrintData(accountKey, year, periodParam);
      phase = "render";
      html = renderPeriodSheetHtml(ctx);
      const num = String(periodParam).replace(/^P/i, "");
      filenameStem = buildFilenameStem(accountKey, `Period${num}_FY${year}`);
    } else if (scope === "season") {
      const ctx = await loadSeasonPrintData(accountKey, year);
      phase = "render";
      html = renderSeasonSheet(ctx);
      filenameStem = buildFilenameStem(accountKey, `Season_FY${year}`);
    } else {
      // scope === "year"
      const ctx = await loadYearPrintData(accountKey, year);
      phase = "render";
      html = renderYearSheet(ctx);
      filenameStem = buildFilenameStem(accountKey, `Year_FY${year}`);
      landscape = false;
    }

    // Chromium launch: dynamic imports keep the ~55MB tarball off any
    // other function's cold start. On Vercel the tarball extracts into
    // /tmp on first invocation and reuses on warm invocations.
    phase = "launch";
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    phase = "pdf";
    const page = await browser.newPage();
    // Set content + wait for the (self-hosted, inlined) fonts to load.
    // networkidle0 is safe here because there is no network I/O at all -
    // fonts are data URIs, seal is a data URI.
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "letter",
      // Month / Period / Season = landscape; Year = portrait. Flag
      // set above per scope.
      landscape,
      printBackground: true,
      // The template CSS sets @page margin:0 and paints its own padding,
      // so we skip puppeteer's margin block.
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    const elapsed = Date.now() - t0;
    const filename = `${filenameStem}.pdf`;
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-SC-Print-Ms": String(elapsed),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (_) { /* already erroring - swallow */ }
    }
    // eslint-disable-next-line no-console
    console.error("[sc-print]", phase, err?.message, err?.stack);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Print failed",
        phase,
        elapsedMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}

// Filename convention: KitchFix_SC_{ACCOUNT}_{SLUG}_{YYYY-MM-DD}.pdf
// Matches the xlsx pattern in scWorkbook.buildFilename so the two
// exports live next to each other in a downloads folder.
function buildFilenameStem(accountKey, slug) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `KitchFix_SC_${safeAccount}_${slug}_${y}-${m}-${d}`;
}
