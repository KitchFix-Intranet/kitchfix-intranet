import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// SC print - Wave 1 mechanism spike (2026-07-13).
//
// This route is a SPIKE ONLY. It proves that serverless headless
// Chrome (@sparticuz/chromium + puppeteer-core) can render a PDF
// on Vercel's Node runtime within the plan's size + timeout limits,
// so that Wave 1 can build the real Month / Period / Season sheets
// against the spec at docs/design/SC_PRINT_SPEC_v1.html.
//
// The route renders a minimal placeholder page - a navy brand band,
// a title, and a paragraph of prose so the PDF is non-empty and
// pagination is exercised. The Wave 1 build replaces the HTML body
// with the real sheet renderer and the auth stays admin-gated (or
// widens to any authenticated operator per Kevin's ruling, matching
// the xlsx export at /api/service-calendar/export).
//
// Runtime + timeout are declared explicitly - the default node runtime
// works for @sparticuz/chromium (the edge runtime does NOT).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;   // seconds - cold start + render + return

export async function GET(request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  const t0 = Date.now();
  let phase = "init";
  let browser = null;

  try {
    // Dynamic imports so the (heavy) chromium package only loads when
    // the route actually fires - not on every unrelated API call.
    phase = "load-chromium";
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    phase = "resolve-executable";
    const executablePath = await chromium.executablePath();

    phase = "launch";
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    phase = "render";
    const page = await browser.newPage();
    const html = spikeHtml();
    await page.setContent(html, { waitUntil: "networkidle0" });

    phase = "pdf";
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
    });

    phase = "close";
    await browser.close();
    browser = null;

    const t1 = Date.now();
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="sc-print-spike.pdf"',
        "X-SC-Print-Spike-Ms":  String(t1 - t0),
        "X-SC-Print-Spike-Phase": "complete",
        "Cache-Control":        "no-store",
      },
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (_) { /* swallowed - already erroring */ }
    }
    // eslint-disable-next-line no-console
    console.error("[sc-print spike]", phase, err?.message, err?.stack);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "spike failed",
        phase,
        elapsedMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}

// Minimal HTML representative of the real Wave 1 sheet shape without
// depending on the spec file. Enough to prove the renderer respects
// @page geometry, background printing, and a navy brand band.
function spikeHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SC print spike</title>
    <style>
      @page { size: letter; margin: 0.4in; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
          Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #0f172a;
        margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .brand-band {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        background: #0f172a;
        color: #ffffff;
      }
      .brand-band .mark {
        font-weight: 700;
        letter-spacing: 0.08em;
        font-size: 14px;
      }
      .brand-band .account {
        font-weight: 600;
        letter-spacing: 0.06em;
        font-size: 11px;
        opacity: 0.85;
      }
      .title {
        margin: 24px 20px 8px;
        font-size: 48px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin: 0 20px 24px;
        font-size: 14px;
        color: #64748b;
      }
      .prose {
        margin: 0 20px;
        font-size: 12px;
        line-height: 1.6;
        max-width: 720px;
      }
      .footer {
        position: fixed;
        left: 20px;
        right: 20px;
        bottom: 12px;
        display: flex;
        justify-content: space-between;
        font-size: 9px;
        color: #94a3b8;
        letter-spacing: 0.06em;
      }
    </style>
  </head>
  <body>
    <div class="brand-band">
      <span class="mark">KITCHFIX</span>
      <span class="account">SC PRINT SPIKE</span>
    </div>
    <h1 class="title">Serverless PDF Spike</h1>
    <p class="subtitle">
      Proves puppeteer-core + @sparticuz/chromium can render a printable
      PDF on Vercel's Node runtime. Wave 1 sheets replace this body with
      the real Month / Period / Season templates against the pixel spec.
    </p>
    <div class="prose">
      <p>
        This document is intentionally minimal. It exercises the parts of
        the pipeline that matter for the real sheets: @page letter geometry,
        margin box, background-color printing (the navy brand band above),
        vector text, and a fixed-position footer.
      </p>
      <p>
        If you are reading this rendered inside a preview build, the mechanism
        is viable. The response includes timing headers (X-SC-Print-Spike-Ms)
        so cold-start latency can be measured. Anything above ~10 seconds on
        cold start is a signal to reconsider the fallback (@react-pdf/renderer
        or print-CSS).
      </p>
    </div>
    <div class="footer">
      <span>SC PRINT SPIKE - MECHANISM ONLY - NOT FOR OPERATIONAL USE</span>
      <span>KITCHFIX</span>
    </div>
  </body>
</html>`;
}
