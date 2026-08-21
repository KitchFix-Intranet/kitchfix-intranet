// scripts/_probe_v42_dom.mjs
//
// V42 PR-B render acceptance. Asserts the RENDERED DOM, not the
// computed server state. Kevin's finding after PR-B first landed:
// U1..U10 passed against server aggregates while both new flags
// (State 2, State 3a) rendered NOTHING on screen, because the
// client-side weekAggregates in page.js dropped the V42 fields and
// WeekTable saw undefined. Probes that assert on inputs cannot
// catch a wiring bug in the render.
//
// This probe spawns `next dev` with TEST_MODE=true, launches a
// headless Chromium, navigates the labor board, and asserts each
// chip is in the DOM at the expected week with the expected copy
// and data-v42-state attribute.
//
// Assertions
//   D1  State 2 (actionable amber) chip renders on the current week
//       (2026-08-17) for STL - FL with `never clocked out` copy
//   D2  State 3a (hygiene, amber-soft) chip renders on wk 2026-08-10
//       for STL - FL with `awaiting approval` copy
//   D3  Bar cap is a DISTINCT element from the solid bar: at least
//       one week where cap > 0 shows a hatched cap AND a solid
//       amber bar beneath (two separate DOM elements, no double-hatch)
//   D4  Legend chip present with the verbatim copy
//   D5  Sentinel row still readable through the UI (CIN - OH 06/29
//       renders with the expected weekly total in the table)
//
// Usage: node scripts/_probe_v42_dom.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const STORAGE_STATE = path.join(REPO_ROOT, "tests/.auth/user.json");

const PORT = process.env.PROBE_PORT || "3100";
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90000;
const NAV_TIMEOUT_MS   = 30000;

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function note(line) { console.log(`  NOTE  ${line}`); }

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20AZ&start=2026-07-06&end=2026-07-12`, {
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 200 || r.status === 400 || r.status === 500) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

console.log("=".repeat(72));
console.log("V42 PR-B DOM acceptance probe");
console.log("=".repeat(72));
console.log(`spinning up next dev on :${PORT} with TEST_MODE=true`);

const proc = spawn("npm", ["run", "dev", "--", "--port", PORT], {
  env: { ...process.env, TEST_MODE: "true", NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderrTail = "";
proc.stdout.on("data", () => {});
proc.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

let exit = 0;
let browser = null;
try {
  const ready = await waitReady(Date.now() + READY_TIMEOUT_MS);
  if (!ready) {
    console.log("");
    console.log("  FAIL  dev server did not become ready within 90s");
    console.log(stderrTail.split("\n").slice(-8).map(l => `    ${l}`).join("\n"));
    exit = 1;
  } else {
    console.log("  dev server ready");

    // Use the cached auth state Playwright's setup step maintains. The
    // client uses useSession() and will bounce to the sign-in prompt
    // without a NextAuth cookie; TEST_MODE only bypasses the server-side
    // middleware, not the client hook. Same discipline the existing
    // Playwright specs use.
    // Client-side auth stub. The route handler bypasses auth via
    // TEST_MODE, but page.js gates its render on useSession() -
    // NextAuth's client hook - which needs a valid /api/auth/session
    // response. Cached storageState goes stale; a lightweight route
    // intercept mocks the session so the probe never depends on
    // interactive OAuth. Only the session endpoint is mocked;
    // every other request hits the real dev server.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { email: "k.fietek@kitchfix.com", name: "Test Runner" },
          expires: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });
    });
    const page = await context.newPage();

    // Navigate to STL - FL over a range that includes both the
    // current week (State 2) and the just-closed lag week (State 3a).
    const url = `${BASE}/kpi/labor?account=STL%20-%20FL&start=2026-07-27&end=2026-08-23`;
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "networkidle" });

    // The board's period band may need expanding to show week rows.
    // Wait for the table to mount first, then try expanding any P8/P9
    // period buttons.
    try {
      await page.waitForSelector(".kpi-tbl-week, .kpi-tbl-band", { timeout: 15000 });
    } catch (e) {
      const cur = page.url();
      const shell = await page.evaluate(() => document.body?.innerText?.slice(0, 800));
      console.log(`  URL after nav: ${cur}`);
      console.log(`  body snippet:  ${(shell || "").replace(/\n+/g, " | ")}`);
      throw e;
    }
    const bandButtons = await page.$$(".kpi-tbl-bandbtn");
    for (const b of bandButtons) {
      const expanded = await b.getAttribute("aria-expanded");
      if (expanded !== "true") await b.click();
    }
    // Give the render a beat to paint the newly-expanded week rows.
    await page.waitForTimeout(500);

    // ─── D1 State 2 on 2026-08-17 -> "never clocked out" ────────────
    console.log("");
    console.log("[D1] STL - FL wk 2026-08-17: State 2 chip renders with 'never clocked out' copy");
    {
      const s2Chips = await page.$$('[data-v42-state="s2"][data-wk="2026-08-17"]');
      if (s2Chips.length === 0) fail(`no State 2 chip found for 2026-08-17 (data-v42-state="s2" data-wk="2026-08-17")`);
      else {
        const txt = (await s2Chips[0].innerText()).trim();
        if (/never clocked out/i.test(txt)) ok(`chip present: "${txt}"`);
        else fail(`chip present but wrong copy: "${txt}"`);
      }
    }

    // ─── D2 State 3a on 2026-08-10 -> "awaiting approval" ───────────
    console.log("");
    console.log("[D2] STL - FL wk 2026-08-10: State 3a chip renders with 'awaiting approval' copy");
    {
      const s3aChips = await page.$$('[data-v42-state="s3a"][data-wk="2026-08-10"]');
      if (s3aChips.length === 0) fail(`no State 3a chip found for 2026-08-10 (data-v42-state="s3a" data-wk="2026-08-10")`);
      else {
        const txt = (await s3aChips[0].innerText()).trim();
        if (/awaiting approval/i.test(txt)) ok(`chip present: "${txt}"`);
        else fail(`chip present but wrong copy: "${txt}"`);
      }
    }

    // ─── D3 Bar cap distinct from solid bar (no double hatch) ───────
    console.log("");
    console.log("[D3] hatched cap is a distinct DOM element and only one hatched layer per bar");
    {
      // Navigate to CIN - AZ P8 (current week has unpriced hours per
      // the render-volume probe: unpriced_hrs > 0 -> cap fires).
      const capUrl = `${BASE}/kpi/labor?account=CIN%20-%20AZ&start=2026-07-27&end=2026-08-23`;
      await page.goto(capUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: "networkidle" });
      await page.waitForSelector(".kpi-wbars", { timeout: 15000 });

      // Cap element is uniquely tagged with kpi-wb-cap-est.
      const capNodes = await page.$$(".kpi-wb-cap-est");
      if (capNodes.length === 0) fail("no .kpi-wb-cap-est nodes on the strip - cap never rendered");
      else ok(`${capNodes.length} cap element(s) present on the strip`);

      // For each week bar, confirm there is AT MOST one hatched
      // background in the plot (cap = hatched, solid bar = solid).
      const doubleHatchCount = await page.evaluate(() => {
        const plots = document.querySelectorAll(".kpi-wb-plot");
        let doubles = 0;
        for (const plot of plots) {
          let hatched = 0;
          for (const el of plot.children) {
            const bg = getComputedStyle(el).backgroundImage || "";
            if (bg.includes("repeating-linear-gradient")) hatched++;
          }
          if (hatched > 1) doubles++;
        }
        return doubles;
      });
      if (doubleHatchCount === 0) ok("no plot has two hatched layers (bar solid, cap alone carries the hatch)");
      else fail(`${doubleHatchCount} plot(s) still have two hatched layers - the boundary is invisible on those`);

      // Also verify the in-progress solid bar's background is solid,
      // not a gradient.
      const inProgBarSolid = await page.evaluate(() => {
        const bars = document.querySelectorAll(".kpi-wb-bar-prog:not(.kpi-wb-cap-est)");
        if (bars.length === 0) return { count: 0 };
        const bg = getComputedStyle(bars[0]).backgroundImage;
        return { count: bars.length, bg };
      });
      if (inProgBarSolid.count === 0) note("no in-progress bar in this range");
      else if (!/gradient/.test(inProgBarSolid.bg || "")) ok(`in-progress bar is solid (no gradient) - hatch reserved for the cap`);
      else fail(`in-progress bar still gradient: ${inProgBarSolid.bg}`);
    }

    // ─── D4 Legend chip present ─────────────────────────────────────
    console.log("");
    console.log("[D4] legend names the hatched cap verbatim");
    {
      const legend = await page.textContent(".kpi-wh");
      if (legend && /hatched = pay data pending, estimated/i.test(legend)) ok("legend chip present");
      else fail(`legend missing the cap key - got: "${(legend || "").slice(0, 200)}"`);
    }

    // ─── D5 sentinel row readable through the UI ─────────────────────
    console.log("");
    console.log("[D5] CIN - OH 06/29 whole-week: table renders the sentinel dollar amount");
    {
      const sentUrl = `${BASE}/kpi/labor?account=CIN%20-%20OH&start=2026-06-29&end=2026-07-05`;
      await page.goto(sentUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: "networkidle" });
      await page.waitForSelector(".kpi-tbl-week, .kpi-tbl-band", { timeout: 15000 });
      // Give React one more paint tick for the amount cell to render.
      await page.waitForTimeout(500);
      const tableText = (await page.textContent("body")) || "";
      // The weekly total should be rendered as $4,328.27 somewhere
      // in the table (band or week row).
      if (tableText.includes("$4,328.27")) ok("sentinel dollar $4,328.27 visible in the rendered table");
      else fail("sentinel dollar $4,328.27 not found in rendered DOM");
    }
  }
} catch (e) {
  fail(`probe crashed: ${e?.message || e}`);
  exit = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  proc.kill("SIGTERM");
  await sleep(500);
  try { proc.kill("SIGKILL"); } catch {}
}

console.log("");
console.log("=".repeat(72));
if (hardFail === 0 && exit === 0) console.log("V42 PR-B DOM: ALL PROBES PASS");
else if (exit !== 0)              console.log("V42 PR-B DOM: dev server or browser never came up - no probes ran");
else                              console.log(`V42 PR-B DOM: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 && exit === 0 ? 0 : 1);
