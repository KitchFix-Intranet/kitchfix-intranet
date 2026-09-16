import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1400 } });

async function measureGap(url, label, tableSel) {
  const p = await ctx.newPage();
  await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(5000);
  const info = await p.evaluate((tableSel) => {
    const cmd = document.querySelector(".kpi-cmd");
    const table = document.querySelector(tableSel);
    if (!cmd || !table) return { cmd: !!cmd, table: !!table };
    const cmdBox = cmd.getBoundingClientRect();
    const tBox = table.getBoundingClientRect();
    return {
      cmdBottom: Math.round(cmdBox.bottom),
      tableTop: Math.round(tBox.top),
      gap: Math.round(tBox.top - cmdBox.bottom),
    };
  }, tableSel);
  console.log(`${label} · ${JSON.stringify(info)}`);
  await p.close();
}

// CP + NP · CurrentPeriodTable
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "Overview CP · to card", ".kpi-ov-cp-card");
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "Overview NP · to card", ".kpi-ov-cp-card");
// CY · what's the first content below cmd bar?
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2025-12-29&end=2026-09-06", "Overview CY · to statusrow", ".kpi-ov-statusrow");
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2025-12-29&end=2026-09-06", "Overview CY · to cardsrow", "[data-kpi-ov='cards-row']");
// LP
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06", "Overview LP · to statusrow", ".kpi-ov-statusrow");

// Status strip on CP + NP
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", "Overview CP · to status", ".kpi-ov-cp-status");
await measureGap("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-10-05&end=2026-11-01", "Overview NP · to status", ".kpi-ov-cp-status");

await b.close();
