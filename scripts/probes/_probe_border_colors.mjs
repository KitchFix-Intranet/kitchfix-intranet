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
      color: c.borderColor,
      top:    c.borderTopColor    + " " + c.borderTopWidth,
      right:  c.borderRightColor  + " " + c.borderRightWidth,
      bottom: c.borderBottomColor + " " + c.borderBottomWidth,
      left:   c.borderLeftColor   + " " + c.borderLeftWidth,
    };
  };
  return {
    hbar:    g(".kpi-ov-cp-hbar"),
    lbar:    g(".kpi-ov-cp-lbar"),
    bpanel:  g(".kpi-ov-cp-bpanel"),
    rowline: (() => { const el = document.querySelector(".kpi-ov-cp-rowline"); return el ? { bg: getComputedStyle(el).backgroundColor } : null; })(),
    // token check
    n300: getComputedStyle(document.querySelector(".kpi-app")).getPropertyValue("--n-300").trim(),
    n700: getComputedStyle(document.querySelector(".kpi-app")).getPropertyValue("--n-700").trim(),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
