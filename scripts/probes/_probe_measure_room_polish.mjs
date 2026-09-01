// Polish gate for the Academy room (owner walk 2026-09-01).
// Asserts + reports at width x height:
//   - Count of elements computing text-decoration-line: line-through
//     across visible text (target: 0)
//   - Occurrences of the literal string "null" in rendered text (0)
//   - --kf-scale + --opd-t-read computed
//   - Greeting h1 + set-title sizes
//   - Five part-row titles as rendered
//   - Module measurements: card width, reading-column width, margins,
//     and the "void below short content" size (owner: ~130px pre-fix)

import { chromium } from "@playwright/test";

const width = Number(process.argv[2] || 1520);
const height = Number(process.argv[3] || 1000);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height },
  storageState: { cookies: [], origins: [] },
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/opd", { waitUntil: "networkidle" });
await page.waitForSelector(".opd-prim", { timeout: 25_000 });

const roomStats = await page.evaluate(() => {
  const app = document.querySelector(".opd-app");
  const cs = app ? getComputedStyle(app) : null;
  // Count elements computing line-through anywhere in the tree.
  let lineThroughCount = 0;
  const lineThroughSamples = [];
  for (const el of document.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if ((style.textDecorationLine || "").split(" ").includes("line-through")) {
      lineThroughCount += 1;
      if (lineThroughSamples.length < 5) {
        lineThroughSamples.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === "string" ? el.className : "").substring(0, 60),
          text: (el.textContent || "").trim().substring(0, 40),
        });
      }
    }
  }
  // Count literal "null" occurrences in rendered visible text.
  const bodyText = document.body.innerText || "";
  const nullMatches = bodyText.match(/\bnull\b/g) || [];
  // Greeting h1 + set title sizes.
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      selector: sel,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      width: Math.round(el.getBoundingClientRect().width),
    };
  };
  // Part-row titles.
  const rowTitles = [...document.querySelectorAll(".opd-prim .opd-pr .opd-pb2 h4")].map((h) => h.textContent);
  // Rail role text.
  const railRole = document.querySelector(".opd-prail-id-role")?.textContent || null;
  // Next-cycle text.
  const nextCycleText = document.querySelector(".opd-nextline")?.textContent || null;
  return {
    kfScale: cs?.getPropertyValue("--kf-scale").trim(),
    opdTRead: cs?.getPropertyValue("--opd-t-read").trim(),
    opdTH2: cs?.getPropertyValue("--opd-t-h2").trim(),
    opdRailW: cs?.getPropertyValue("--opd-rail-w").trim(),
    opdMeasure: cs?.getPropertyValue("--opd-measure").trim(),
    greetH1: pick(".opd-phead h1"),
    setTitle: pick(".opd-set .opd-seth h3"),
    partTitle: pick(".opd-prim .opd-pr .opd-pb2 h4"),
    rowHeight: (() => {
      const el = document.querySelector(".opd-prim .opd-pr");
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    })(),
    lineThroughCount,
    lineThroughSamples,
    nullOccurrences: nullMatches.length,
    rowTitles,
    railRole,
    nextCycleText,
  };
});

// Now navigate into a module to measure card width, reading col, and
// short-content void.
let moduleStats = null;
try {
  const openRow = page.locator(".opd-prim .opd-pr:not(.opd-pr--lk)").first();
  await openRow.click();
  await page.waitForSelector(".opd-uni", { timeout: 20_000 });
  await page.waitForSelector(".opd-uni .opd-ucw h2", { timeout: 20_000 });
  moduleStats = await page.evaluate(() => {
    const app = document.querySelector(".opd-app");
    const cs = getComputedStyle(app);
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        selector: sel,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const card = document.querySelector(".opd-uni");
    const ucw = document.querySelector(".opd-uni .opd-ucw");
    const pane = document.querySelector(".opd-upane");
    const foot = document.querySelector(".opd-uni .opd-ufoot");
    const ubody = document.querySelector(".opd-uni .opd-ubody");
    const cardW = card ? Math.round(card.getBoundingClientRect().width) : null;
    const ucwW = ucw ? Math.round(ucw.getBoundingClientRect().width) : null;
    const marginEach = cardW && ucwW ? Math.round((cardW - ucwW) / 2) : null;
    // "Void below short content": gap between the pane's bottom and the
    // footer's top - the ~130px owner reported.
    let voidBelow = null;
    if (pane && foot) {
      const p = pane.getBoundingClientRect();
      const f = foot.getBoundingClientRect();
      voidBelow = Math.round(f.top - p.bottom);
    }
    return {
      opdTRead: cs.getPropertyValue("--opd-t-read").trim(),
      cardW,
      ucwW,
      marginEach,
      voidBelow,
      pane: pick(".opd-upane"),
      stepH2: pick(".opd-uni .opd-ucw h2"),
      stepPara: pick(".opd-uni .opd-ucw p"),
      ubodyAlignItems: ubody ? getComputedStyle(ubody).alignItems : null,
    };
  });
} catch (e) {
  moduleStats = { error: String(e).substring(0, 200) };
}

console.log(JSON.stringify({
  viewport: { width, height },
  pageErrors: errors,
  room: roomStats,
  module: moduleStats,
}, null, 2));

await browser.close();
