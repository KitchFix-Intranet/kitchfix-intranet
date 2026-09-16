import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" }, viewport: { width: 1440, height: 1400 } });
const p = await ctx.newPage();
await p.route("**/api/auth/session", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ user: { name: "K", email: "kevin@kitchfix.com" }, expires: new Date(Date.now()+864e5).toISOString() }) }));
await p.goto("http://localhost:3000/kpi/overview?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5000);
const info = await p.evaluate(() => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = getComputedStyle(el);
    return {
      borderTop: c.borderTopWidth + " " + c.borderTopStyle,
      borderRight: c.borderRightWidth + " " + c.borderRightStyle,
      borderBottom: c.borderBottomWidth + " " + c.borderBottomStyle,
      borderLeft: c.borderLeftWidth + " " + c.borderLeftStyle,
      radius: c.borderRadius,
      shadow: c.boxShadow.slice(0, 60),
      bg: c.background.slice(0, 40),
    };
  };
  return {
    card:   g(".kpi-ov-cp-card"),
    hbar:   g(".kpi-ov-cp-hbar"),
    lbar:   g(".kpi-ov-cp-lbar"),
    bpanel: g(".kpi-ov-cp-bpanel"),
    rowline: g(".kpi-ov-cp-rowline"),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
