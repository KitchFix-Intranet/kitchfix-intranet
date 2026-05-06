// ════════════════════════════════════════════════════════════════════════════
// performancePdf — Railway WeasyPrint client
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 7 — test mode)
// ════════════════════════════════════════════════════════════════════════════

const RAILWAY_URL = process.env.WEASYPRINT_SERVICE_URL || "";
const RENDER_SECRET = process.env.PERFORMANCE_RENDER_SECRET || "";

async function callRender(endpoint, body) {
  if (!RAILWAY_URL || !RENDER_SECRET) {
    console.warn("[performancePdf] WEASYPRINT_SERVICE_URL or PERFORMANCE_RENDER_SECRET not set; skipping");
    return { ok: false, reason: "not-configured" };
  }
  try {
    const res = await fetch(`${RAILWAY_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Render-Secret": RENDER_SECRET,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return await res.json();
  } catch (e) {
    console.error(`[performancePdf] ${endpoint} failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

export async function renderWowPlanPdf(plan, testMode = false) {
  return callRender("/render/wow-plan", { ...plan, _test_mode: testMode });
}

export async function renderCycleReviewPdf(review, testMode = false) {
  return callRender("/render/cycle-review", { ...review, _test_mode: testMode });
}

export async function pingWeasyprint() {
  if (!RAILWAY_URL) return { ok: false, reason: "not-configured" };
  try {
    const res = await fetch(`${RAILWAY_URL}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}