// _verify-sous-layout.mjs (throwaway, PR B closeout 2026-08-02)
//
// Kevin ruled: previous CSS fix was reported without an actual long-answer
// render. This script closes that gap by:
//   1. Loading sous.css into a fixture DOM that mirrors the real page
//      structure (sa-page -> sa-shell -> sa-workspace -> sa-main
//      -> sa-pane-scroll + sa-composer sibling). Same class chain, same
//      selectors, same cascade.
//   2. Injecting a tall answer block into .sa-pane to force overflow.
//   3. Running Kevin's exact measurement snippet from the ruling message.
//   4. Also sweeping landing zero-scroll at 800/768/717 heights.
//
// Fixture avoids the auth requirement of a real /sous render while
// exercising the exact CSS chain that determines whether the composer
// stays reachable when answers grow. If .sa-shell lacks min-height:0
// this reproduces Kevin's original failure signature; with the fix
// applied the composer stays pinned and only .sa-pane-scroll scrolls.

import { chromium } from "playwright";
import { readFileSync } from "fs";

const sousCss = readFileSync("src/app/sous/sous.css", "utf8");
const topnavCss = readFileSync("src/components/TopNav.css", "utf8");

const LONG_ANSWER = Array.from({ length: 60 }, (_, i) =>
  `<p>Line ${i + 1}: KitchFix allergen procedure boilerplate. The Top 9 allergens are milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, and sesame. Severe allergies escalate through the dietitian and the EC; station-level substitution is never a call the line cook makes solo. Source: PB-002 Allergen Playbook.</p>`
).join("\n");

const HTML = `<!doctype html>
<html>
<head>
<style>
  html, body { margin: 0; padding: 0; }
  :root { --kf-navy: #0F3057; --accent-sous: #F97316; --accent-sous-deep: #EA580C; --text-default: #0F172A; --kf-border: #E4E8EC; }
  /* Fake TopNav placeholder so .sa-page's height:calc(100dvh - var(--kf-topnav-h)) has the right frame. */
  .fake-nav { height: 56px; background: #0F3057; }
  ${topnavCss}
  ${sousCss}
</style>
</head>
<body>
  <div class="fake-nav"></div>
  <div class="sa-page">
    <div class="sa-shell">
      <div class="sa-hero"><div>Hero placeholder</div></div>
      <div class="sa-workspace">
        <aside class="sa-rail" aria-label="Session history">
          <div class="sa-rail-head">rail head</div>
          <div class="sa-rail-scroll">rail scroll</div>
          <p class="sa-rail-footer">rail footer</p>
        </aside>
        <main class="sa-main">
          <div class="sa-pane-scroll">
            <div class="sa-pane">
              <article class="sa-turn">
                <div class="sa-answer sa-answer--grounded">
                  <div class="sa-answer-header">
                    <span class="sa-question-bar"></span>
                    <span class="sa-question-text">What's our allergen procedure?</span>
                    <span class="sa-status-pill sa-status-pill--grounded">Grounded</span>
                  </div>
                  <div class="sa-answer-body">
                    ${LONG_ANSWER}
                  </div>
                </div>
              </article>
            </div>
          </div>
          <button class="sa-fab-scroll-top" aria-label="Scroll to top"></button>
          <div class="sa-composer">
            <form class="sa-ask-form">
              <div class="sa-ask-row">
                <input type="text" class="sa-ask-input" aria-label="Ask Sous a question" placeholder="Ask..." />
                <button type="submit" class="sa-ask-send">up</button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  </div>
</body>
</html>`;

const LANDING_HTML = HTML.replace(
  /<article class="sa-turn">[\s\S]*?<\/article>/,
  `<div class="sa-firstrun">
     <p class="sa-firstrun-lead">What can I look up for you?</p>
     <p class="sa-firstrun-tag">Every answer names its source. Sous declines rather than guessing. Sous can make mistakes - always verify against the sources.</p>
     <div class="sa-brief">
       <div class="sa-brow sa-brow--pb"><span class="sa-brow-title">Playbook</span></div>
       <div class="sa-brow sa-brow--pp"><span class="sa-brow-title">People</span></div>
       <div class="sa-brow sa-brow--sc"><span class="sa-brow-title">Service Calendar</span></div>
       <div class="sa-brow sa-brow--ops"><span class="sa-brow-title">Spend</span></div>
       <p class="sa-brief-limits">No wages, no reimbursements, no HR or Legal sensitive information. P&amp;L + KPIs coming soon. Current 2026 season only. Past data pending.</p>
     </div>
   </div>`
);

const MEASURE = `(()=>{const de=document.documentElement;const f=document.querySelector('[aria-label="Ask Sous a question"]').closest('form');const sc=document.querySelector('.sa-pane-scroll');return {pageScroll:de.scrollHeight-de.clientHeight, composerBottomGap:Math.round(innerHeight-f.getBoundingClientRect().bottom), regionScrollable:sc.scrollHeight-sc.clientHeight}})()`;

const browser = await chromium.launch();

// A. Long-answer measurement at 1440x900 (typical desktop).
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil: "load" });
  const m = await page.evaluate(MEASURE);
  console.log("LONG-ANSWER @ 1440x900:", JSON.stringify(m));
  await ctx.close();
}

// B. Landing zero-scroll sweep at 800 / 768 / 717 heights.
for (const h of [800, 768, 717]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: h } });
  const page = await ctx.newPage();
  await page.setContent(LANDING_HTML, { waitUntil: "load" });
  const m = await page.evaluate(`(()=>{const de=document.documentElement;const f=document.querySelector('[aria-label="Ask Sous a question"]').closest('form');return {pageScroll:de.scrollHeight-de.clientHeight, composerBottomGap:Math.round(innerHeight-f.getBoundingClientRect().bottom)}})()`);
  console.log(`LANDING @ 1440x${h}:`, JSON.stringify(m));
  await ctx.close();
}

await browser.close();
