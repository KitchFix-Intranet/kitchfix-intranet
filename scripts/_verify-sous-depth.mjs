// _verify-sous-depth.mjs (throwaway, fix/sous-depth-wells 2026-08-03)
//
// Companion to _verify-sous-layout.mjs. Same fixture pattern (loads sous.css
// + TopNav.css into a DOM that mirrors real .sa-page structure so cascade,
// specificity, and computed styles match production) but adds:
//   - screenshots at 1440x900 for landing + long answer + panel-shape
//   - contrast measurements for text that now sits directly on the well
//     fill #E9EDF2 (rail heading, rail empty, rail footer, plus the
//     .sa-rail-incontext-marker which uses accent-sous-deep for brand
//     identity)
//
// Purpose: close Kevin's [ran] gap for the depth polish. Layout regression
// is separately covered by scripts/_verify-sous-layout.mjs which re-runs
// green post-depth (same measurements as PR B baseline).

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";

mkdirSync("/tmp/sous-depth", { recursive: true });

const sousCss = readFileSync("src/app/sous/sous.css", "utf8");
const topnavCss = readFileSync("src/components/TopNav.css", "utf8");

const LONG_ANSWER = Array.from({ length: 60 }, (_, i) =>
  `<p>Line ${i + 1}: KitchFix allergen procedure boilerplate. Top 9 allergens are milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, sesame. Escalation to the dietitian and EC on any severe allergy; station-level substitution is never a solo call. Source: PB-002.</p>`
).join("\n");

// Real .sa-page shape - rail with three items (one --incontext, two outside),
// main with the tall answer card. This matches the composition in the study.
// Rail items updated 2026-08-03 for rail-honesty ruling: <div> not <button>,
// includes ask-again icon button + IN CONTEXT hint line.
const RAIL_ITEM = (extraClass, dot, time, q) => `
  <li><div class="sa-rail-item ${extraClass}">
    <span class="sa-rail-item-meta"><span class="sa-rail-status-dot sa-rail-status-dot--${dot}"></span><span class="sa-rail-item-time">${time}</span></span>
    <span class="sa-rail-item-q">${q}</span>
    <button class="sa-rail-item-askagain" aria-label="Ask this again"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
  </div></li>`;
const PAGE_HTML = (bodyInner) => `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  :root { --kf-navy: #0F3057; --accent-sous: #F97316; --accent-sous-deep: #EA580C; --accent-sous-line: #FED7AA; --accent-sous-subtle: #FFF7ED; --text-default: #0F172A; --kf-border: #E4E8EC; --kf-ink: #111827; }
  .fake-nav { height: 56px; background: #0F3057; }
  ${topnavCss}
  ${sousCss}
</style></head><body>
  <div class="fake-nav"></div>
  <div class="sa-page">
    <div class="sa-shell">
      <div class="sa-hero"><div>Hero placeholder</div></div>
      <div class="sa-workspace">
        <aside class="sa-rail" aria-label="Session history">
          <div class="sa-rail-head">
            <button class="sa-rail-newbtn"><span class="sa-rail-newbtn-lead">+ New question</span><span class="sa-rail-newbtn-kbd">⌘K</span></button>
          </div>
          <div class="sa-rail-scroll">
            <p class="sa-rail-heading">This session</p>
            <span class="sa-rail-incontext-marker">In context</span>
            <span class="sa-rail-incontext-hint">Sous remembers these three.</span>
            <ul class="sa-rail-list">
              ${RAIL_ITEM("sa-rail-item--incontext", "grounded", "6:51 AM CDT", "What's our allergen procedure?")}
            </ul>
            <div class="sa-rail-context-boundary"></div>
            <ul class="sa-rail-list">
              ${RAIL_ITEM("sa-rail-item--outside-context", "partial", "6:33 AM CDT", "break out the top one")}
              ${RAIL_ITEM("sa-rail-item--outside-context", "declined", "6:32 AM CDT", "holiday pay?")}
            </ul>
          </div>
          <p class="sa-rail-footer">Session only - clears when you reload.</p>
        </aside>
        <main class="sa-main">
          <div class="sa-pane-scroll">
            <div class="sa-pane">
              ${bodyInner}
            </div>
          </div>
          <div class="sa-composer">
            <form class="sa-ask-form">
              <div class="sa-ask-row">
                <input type="text" class="sa-ask-input" aria-label="Ask Sous a question" placeholder="Ask about a policy, a person..." />
                <button type="submit" class="sa-ask-send">up</button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  </div>
</body></html>`;

const LANDING_INNER = `
  <div class="sa-firstrun">
    <p class="sa-firstrun-lead">What can I look up for you?</p>
    <p class="sa-firstrun-tag">Every answer names its source. Sous declines rather than guessing. Sous can make mistakes - always verify against the sources.</p>
    <div class="sa-brief">
      <div class="sa-brow sa-brow--pb"><span class="sa-brow-title">Playbook</span></div>
      <div class="sa-brow sa-brow--pp"><span class="sa-brow-title">People</span></div>
      <div class="sa-brow sa-brow--sc"><span class="sa-brow-title">Service Calendar</span></div>
      <div class="sa-brow sa-brow--ops"><span class="sa-brow-title">Spend</span></div>
      <p class="sa-brief-limits">No wages, no reimbursements, no HR or Legal sensitive information. P&amp;L + KPIs coming soon. Current 2026 season only. Past data pending.</p>
    </div>
  </div>`;

const ANSWER_INNER = `
  <article class="sa-turn">
    <div class="sa-answer sa-answer--grounded">
      <div class="sa-answer-header">
        <span class="sa-question-bar"></span>
        <span class="sa-question-text">What's our allergen procedure?</span>
        <span class="sa-status-pill sa-status-pill--grounded">Grounded</span>
      </div>
      <div class="sa-answer-body">${LONG_ANSWER}</div>
      <div class="sa-sources">
        <a class="sa-source-row" href="#"><span class="sa-source-idchip">PB-002</span><span class="sa-source-title">Allergen Playbook</span></a>
        <a class="sa-source-row" href="#"><span class="sa-source-idchip">SOP-002</span><span class="sa-source-title">Incident Reporting SOP</span></a>
      </div>
    </div>
  </article>`;

// Wide-table case: 8-column vendor spend table with values wide enough that
// the natural table width exceeds the 840 card cap. Confirms tables keep
// width:100% and clip within card padding rather than being constrained
// or the card overflowing.
const WIDE_TABLE_INNER = `
  <article class="sa-turn">
    <div class="sa-answer sa-answer--grounded">
      <div class="sa-answer-header">
        <span class="sa-question-bar"></span>
        <span class="sa-question-text">top vendors this year?</span>
        <span class="sa-status-pill sa-status-pill--grounded">Grounded</span>
      </div>
      <div class="sa-answer-body">
        <p>38 canonical vendors YTD. Top five below with fees and share; the remaining 33 add another 24% of portfolio spend.</p>
        <table>
          <thead>
            <tr><th>Vendor</th><th>Category</th><th data-num>YTD Spend</th><th data-num>Invoices</th><th data-num>Avg / Invoice</th><th data-num>Share YTD</th><th>First Order</th><th>Last Order</th></tr>
          </thead>
          <tbody>
            <tr><td>Sysco Southeast Florida</td><td>Food broadline</td><td data-num>$244,954.05</td><td data-num>47</td><td data-num>$5,211.79</td><td data-num>19.5%</td><td>2026-02-14</td><td>2026-07-30</td></tr>
            <tr><td>Shamrock Foods</td><td>Food secondary</td><td data-num>$102,183.44</td><td data-num>28</td><td data-num>$3,649.41</td><td data-num>8.1%</td><td>2026-02-16</td><td>2026-07-29</td></tr>
            <tr><td>Ben E Keith</td><td>Food broadline</td><td data-num>$88,447.13</td><td data-num>21</td><td data-num>$4,211.77</td><td data-num>7.0%</td><td>2026-03-01</td><td>2026-07-28</td></tr>
            <tr><td>What Chefs Want</td><td>Produce</td><td data-num>$71,220.90</td><td data-num>34</td><td data-num>$2,094.73</td><td data-num>5.7%</td><td>2026-02-14</td><td>2026-07-30</td></tr>
            <tr><td>Cheney Brothers</td><td>Food secondary</td><td data-num>$54,982.11</td><td data-num>17</td><td data-num>$3,234.24</td><td data-num>4.4%</td><td>2026-03-05</td><td>2026-07-26</td></tr>
          </tbody>
        </table>
      </div>
      <div class="sa-sources">
        <a class="sa-source-row" href="#"><span class="sa-source-idchip">spend_top_vendors</span><span class="sa-source-title">PG live</span></a>
      </div>
    </div>
  </article>`;

const PANEL_HTML = `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: rgba(15,48,87,0.35); }
  :root { --kf-navy: #0F3057; --accent-sous: #F97316; --accent-sous-deep: #EA580C; --accent-sous-line: #FED7AA; --accent-sous-subtle: #FFF7ED; --text-default: #0F172A; --kf-border: #E4E8EC; --kf-ink: #111827; }
  ${topnavCss}
  ${sousCss}
  /* Panel shell approximation - real .pb-sous-panel styles live in playbook.css and were untouched. Fixture uses inline. */
  .pb-sous-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 580px; background: white; box-shadow: var(--elev-3); display: flex; flex-direction: column; }
  .pb-sous-head { background: linear-gradient(90deg, #0F3057 0%, #EA580C 100%); color: white; padding: 14px 18px; font-weight: 700; }
</style></head><body>
  <div class="pb-sous-panel">
    <div class="pb-sous-head">Sous · Playbook context</div>
    <div class="sa-overlay-wrap">
      <div class="sa-overlay-body-scroll">
        ${ANSWER_INNER}
      </div>
      <div class="sa-overlay-foot">
        <form class="sa-ask-form">
          <div class="sa-ask-row">
            <input type="text" class="sa-ask-input" aria-label="Ask Sous a question" placeholder="Ask..." />
            <button type="submit" class="sa-ask-send">up</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</body></html>`;

// WCAG relative-luminance contrast between two sRGB hex colours.
function relLuminance(hex) {
  const rgb = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16) / 255);
  const linear = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrastRatio(fg, bg) {
  const [l1, l2] = [relLuminance(fg), relLuminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const browser = await chromium.launch();

// ── A. Screenshots at 1440x900 ──────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.setContent(PAGE_HTML(LANDING_INNER), { waitUntil: "load" });
  await page.screenshot({ path: "/tmp/sous-depth/landing-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-depth/landing-1440x900.png");

  await page.setContent(PAGE_HTML(ANSWER_INNER), { waitUntil: "load" });
  await page.evaluate(() => { const sc = document.querySelector('.sa-pane-scroll'); sc.scrollTop = Math.round(sc.scrollHeight / 3); });
  await page.screenshot({ path: "/tmp/sous-depth/long-answer-mid-scroll-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-depth/long-answer-mid-scroll-1440x900.png");

  await page.setContent(PAGE_HTML(WIDE_TABLE_INNER), { waitUntil: "load" });
  await page.screenshot({ path: "/tmp/sous-depth/wide-table-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-depth/wide-table-1440x900.png");

  await page.setContent(PANEL_HTML, { waitUntil: "load" });
  await page.screenshot({ path: "/tmp/sous-depth/panel-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-depth/panel-1440x900.png");

  // Rail-honesty verification (added 2026-08-03): rail with IN CONTEXT hint
  // visible, one rail item hovered (ask-again button revealed), and one
  // rail item's ask-again button focused (keyboard tab-reachable state).
  await page.setContent(PAGE_HTML(ANSWER_INNER), { waitUntil: "load" });
  await page.locator('.sa-rail-item--incontext').first().hover();
  await page.screenshot({ path: "/tmp/sous-depth/rail-hover-1440x900.png", clip: { x: 0, y: 200, width: 320, height: 400 } });
  console.log("SCREENSHOT: /tmp/sous-depth/rail-hover-1440x900.png (rail clip, hover)");

  await page.setContent(PAGE_HTML(ANSWER_INNER), { waitUntil: "load" });
  await page.locator('.sa-rail-item-askagain').first().focus();
  await page.screenshot({ path: "/tmp/sous-depth/rail-askagain-focus-1440x900.png", clip: { x: 0, y: 200, width: 320, height: 400 } });
  console.log("SCREENSHOT: /tmp/sous-depth/rail-askagain-focus-1440x900.png (rail clip, keyboard focus)");

  await ctx.close();
}

// ── B. Contrast spot-check on well-fill text ────────────────────────────────
// The prompt names four elements: rail-heading (THIS SESSION), rail-footer,
// rail-empty text, and composer placeholder. The composer sits on the tray
// (#EFF2F6 not the primary well), and placeholder colour comes from the
// input's own bg (white), so it's excluded from the well check. Added the
// IN CONTEXT marker as a judgment-call reading.
const wellFg = ["#475569", "#EA580C"];
const wellBg = "#E9EDF2";
const trayBg = "#EFF2F6";
console.log("");
console.log("CONTRAST vs well fill #E9EDF2 (WCAG AA target: 4.5:1 normal text):");
for (const fg of wellFg) {
  const ratio = contrastRatio(fg, wellBg).toFixed(2);
  const verdict = parseFloat(ratio) >= 4.5 ? "PASS" : parseFloat(ratio) >= 3.0 ? "AA-LARGE-ONLY" : "FAIL";
  console.log(`  ${fg} on ${wellBg}: ${ratio}:1  ${verdict}`);
}
console.log("");
console.log("CONTRAST vs tray fill #EFF2F6:");
console.log(`  ${"#475569"} on ${trayBg}: ${contrastRatio("#475569", trayBg).toFixed(2)}:1  (composer chrome baseline)`);
console.log("");
console.log("Reference (pre-depth baselines that shipped on white bg):");
console.log(`  #94A3B8 on #FFFFFF: ${contrastRatio("#94A3B8", "#FFFFFF").toFixed(2)}:1  (old rail heading colour - failed 4.5:1 on white too)`);
console.log(`  #94A3B8 on ${wellBg}: ${contrastRatio("#94A3B8", wellBg).toFixed(2)}:1  (what depth would have shipped un-darkened)`);

await browser.close();
