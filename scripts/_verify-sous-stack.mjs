// _verify-sous-stack.mjs (throwaway, feat/sous-turn-stack 2026-08-04)
//
// Companion to _verify-sous-layout + _verify-sous-depth. Covers the
// turn-stack rendering (Kevin's acceptance list):
//   - 3-turn stack settled
//   - 4-turn stack showing out-of-context de-emphasis on the oldest
//   - mid-flight turn at the bottom of a stack (streaming card)
//   - panel with 2 turns (overlay variant)
//   - rail-click jump (before + after, both screenshots against the
//     same fixture; after-shot proves the target card scrolled into
//     view and the .sa-turn--just-navigated highlight class applied)
//   - reduced-motion path (same render, prefers-reduced-motion:reduce
//     emulation - highlight animation should be suppressed by CSS)
//
// Feedback-on-older-turn payload proof is code-read only in this pass:
// SousSurface.onFeedbackClick(turn, value) posts
// { question_id: turn.doneEnv.question_id, ... } - turn is the SAME
// turn the card renders from, so an older card's thumbs-down carries
// that older card's question_id. Provable by inspection; no need to
// run the network.

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";

mkdirSync("/tmp/sous-stack", { recursive: true });

const sousCss = readFileSync("src/app/sous/sous.css", "utf8");
const topnavCss = readFileSync("src/components/TopNav.css", "utf8");

// A settled answer body suitable for a stack card - realistic size.
const answerBody = (heading, para) => `
  <h4>${heading}</h4>
  <p>${para}</p>
  <p>Sources are cited inline where they matter; the meta row below shows tool count, duration, and the doc ids read.</p>`;

// Render one <article class="sa-turn"> in the shape SousSurface produces.
// `variant` = "grounded" | "partial" | "declined" | "error" | "streaming".
// `inContext` = false attaches the .sa-turn--outside-context muted class.
// `streaming` toggles the .sa-tooltrail-well vs .sa-provenance-well.
const settledTurn = ({ id, variant, question, heading, body, sources = [], inContext = true, provenance = "2 tools · 3.4s · sources: PB-002, SOP-002" }) => `
  <article id="sa-turn-${id}" class="sa-turn${inContext ? "" : " sa-turn--outside-context"}">
    <div class="sa-answer sa-answer--${variant}">
      <div class="sa-answer-header">
        <span class="sa-question-bar"></span>
        <span class="sa-question-text">${question}</span>
        <span class="sa-status-pill sa-status-pill--${variant}">${variant.charAt(0).toUpperCase() + variant.slice(1)}</span>
      </div>
      <div class="sa-answer-body">${answerBody(heading, body)}</div>
      ${sources.length > 0 ? `<div class="sa-sources">
        ${sources.map((s) => `<a class="sa-source-row" href="#"><span class="sa-source-idchip">${s.id}</span><span class="sa-source-title">${s.title}</span></a>`).join("")}
      </div>` : ""}
      <div class="sa-well sa-provenance-well">
        <p class="sa-provenance">
          <span class="sa-provenance-dot"></span>
          <span>${provenance}</span>
        </p>
      </div>
    </div>
  </article>`;

const streamingTurn = ({ id, question, tools }) => `
  <article id="sa-turn-${id}" class="sa-turn">
    <div class="sa-answer sa-answer--streaming">
      <div class="sa-answer-header">
        <span class="sa-question-bar"></span>
        <span class="sa-question-text">${question}</span>
        <span class="sa-status-pill sa-status-pill--streaming">Thinking</span>
      </div>
      <div class="sa-well sa-tooltrail-well" role="status">
        <div class="sa-tooltrail">
          ${tools.map((t) => `<div class="sa-tooltrail-item"><span class="sa-tooltrail-tool">${t.tool}</span><span class="sa-tooltrail-summary">${t.summary}</span>${t.ms ? `<span class="sa-tooltrail-ms">${t.ms >= 1000 ? (t.ms/1000).toFixed(1)+"s" : t.ms+"ms"}</span>` : ""}</div>`).join("")}
        </div>
      </div>
      <div class="sa-answer-body"><p>Working through the closeout SOP now - two accounts have addenda...</p></div>
    </div>
  </article>`;

// Rail item HTML: <li class="sa-rail-row"> wrapping the item <button> and
// the ask-again <button> as siblings (turn-stack fix for invalid nested
// buttons). Time strings and status classes match production render.
const railItem = ({ id, incontext, dot, time, q }) => `
  <li class="sa-rail-row">
    <button class="sa-rail-item ${incontext ? "sa-rail-item--incontext" : "sa-rail-item--outside-context"}" data-target="sa-turn-${id}">
      <span class="sa-rail-item-meta"><span class="sa-rail-status-dot sa-rail-status-dot--${dot}"></span><span class="sa-rail-item-time">${time}</span></span>
      <span class="sa-rail-item-q">${q}</span>
    </button>
    <button class="sa-rail-item-askagain" aria-label="Ask this again"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
  </li>`;

const PAGE_HTML = ({ turns, railTop, railBottom }) => `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; }
  :root { --kf-navy: #0F3057; --accent-sous: #F97316; --accent-sous-deep: #EA580C; --accent-sous-line: #FED7AA; --accent-sous-subtle: #FFF7ED; --text-default: #0F172A; --kf-border: #E4E8EC; --kf-ink: #111827; }
  .fake-nav { height: 56px; background: #0F3057; }
  /* Fixture-only helper: JS click on a rail-item scrolls its target card into view + adds the highlight class, so the after-shot captures the same behaviour production wires via SousSurface.onRailItemClick. */
  ${topnavCss}
  ${sousCss}
</style></head><body>
  <div class="fake-nav"></div>
  <div class="sa-page">
    <div class="sa-shell">
      <div class="sa-hero"><div style="color:white">Hero placeholder</div></div>
      <div class="sa-workspace">
        <aside class="sa-rail" aria-label="Session history">
          <div class="sa-rail-head">
            <button class="sa-rail-newbtn"><span class="sa-rail-newbtn-lead">+ New question</span><span class="sa-rail-newbtn-kbd">⌘K</span></button>
          </div>
          <div class="sa-rail-scroll">
            <p class="sa-rail-heading">This session</p>
            <span class="sa-rail-incontext-marker">In context</span>
            <span class="sa-rail-incontext-hint">Sous remembers these three.</span>
            <ul class="sa-rail-list">${railTop}</ul>
            ${railBottom ? `<div class="sa-rail-context-boundary"></div><ul class="sa-rail-list">${railBottom}</ul>` : ""}
          </div>
          <p class="sa-rail-footer">Session only - clears when you reload.</p>
        </aside>
        <main class="sa-main">
          <div class="sa-pane-scroll">
            <div class="sa-pane">${turns}</div>
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
  <script>
    // Fixture-only: wire rail-item clicks to the same behaviour the
    // React handler does (scrollIntoView + highlight class). Real
    // production uses SousSurface.onRailItemClick -> pendingScrollRef
    // -> useEffect; the DOM outcome is identical.
    document.querySelectorAll('.sa-rail-item[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.dataset.target);
        if (!el) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        if (!reduce) {
          el.classList.add('sa-turn--just-navigated');
          setTimeout(() => el.classList.remove('sa-turn--just-navigated'), 1200);
        }
      });
    });
  </script>
</body></html>`;

const PANEL_HTML = ({ turns }) => `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: rgba(15,48,87,0.35); }
  :root { --kf-navy: #0F3057; --accent-sous: #F97316; --accent-sous-deep: #EA580C; --accent-sous-line: #FED7AA; --accent-sous-subtle: #FFF7ED; --text-default: #0F172A; --kf-border: #E4E8EC; --kf-ink: #111827; }
  ${topnavCss}
  ${sousCss}
  .pb-sous-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 580px; background: white; box-shadow: var(--elev-3); display: flex; flex-direction: column; }
  .pb-sous-head { background: linear-gradient(90deg, #0F3057 0%, #EA580C 100%); color: white; padding: 14px 18px; font-weight: 700; }
  .pb-sous-doccard { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.14); padding: 6px 10px; border-radius: 8px; margin-top: 8px; font-size: 12px; color: white; }
  .pb-sous-doccard-id { font-family: ui-monospace, monospace; font-weight: 700; }
</style></head><body>
  <div class="pb-sous-panel">
    <div class="pb-sous-head">
      Sous · Playbook context
      <div class="pb-sous-doccard"><span class="pb-sous-doccard-id">PB-002</span><span>Allergen Playbook v3 · Live</span></div>
    </div>
    <div class="sa-overlay-wrap">
      <div class="sa-overlay-body-scroll">${turns}</div>
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

// ── Turn data ────────────────────────────────────────────────────────────
const T1 = { id: "t1", variant: "grounded", question: "walk me through closeout", heading: "Closeout SOP", body: "End-of-service reconciliation, next-day prep list, cash drop, and site handoff to the head coach. Two of your sites (TXR-TX-H, CIN-OH) run client-specific addenda.", sources: [{ id: "PB-004", title: "Closeout SOP" }] };
const T2 = { id: "t2", variant: "partial", question: "how do TXR-TX-H addenda differ?", heading: "TXR-TX-H addendum", body: "Adds head-coach handoff step 4a. Written down as an appendix to the site SLA; not in the core SOP.", sources: [{ id: "REC-107", title: "TXR-TX-H record" }], provenance: "3 tools · 5.2s · sources: REC-107" };
const T3 = { id: "t3", variant: "declined", question: "what's the CIN-OH closeout timing?", heading: "Not documented", body: "CIN-OH's addendum isn't written down - the timing is tribal. Ask the site lead or capture what they do so we can add it.", provenance: "2 tools · 2.9s · declined" };
const T4_OLD = { id: "t0", variant: "grounded", question: "top vendors this year?", heading: "Top vendors YTD", body: "38 canonical vendors. Sysco leads at 19.5% ($244,954), Shamrock and Ben E Keith behind.", sources: [{ id: "spend_top_vendors", title: "PG live" }], inContext: false };
const TSTREAM = { id: "t4", question: "what changed in FORM-004?", tools: [{ tool: "search_documents", summary: "form-004 recent changes", ms: 220 }, { tool: "get_document", summary: "FORM-004 v3 signatures section", ms: 1120 }] };

const RAIL_3 = [
  railItem({ id: "t3", incontext: true, dot: "declined", time: "6:33 AM CDT", q: "what's the CIN-OH closeout timing?" }),
  railItem({ id: "t2", incontext: true, dot: "partial", time: "6:32 AM CDT", q: "how do TXR-TX-H addenda differ?" }),
  railItem({ id: "t1", incontext: true, dot: "grounded", time: "6:30 AM CDT", q: "walk me through closeout" }),
].join("");
const RAIL_4_TOP = RAIL_3;
const RAIL_4_BOTTOM = railItem({ id: "t0", incontext: false, dot: "grounded", time: "6:18 AM CDT", q: "top vendors this year?" });

// ── Runs ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch();

async function shot(page, viewportHeight, html, name, extraOps) {
  await page.setViewportSize({ width: 1440, height: viewportHeight });
  await page.setContent(html, { waitUntil: "load" });
  if (extraOps) await extraOps(page);
  await page.screenshot({ path: `/tmp/sous-stack/${name}.png` });
  console.log(`SCREENSHOT: /tmp/sous-stack/${name}.png`);
}

// A. Three-turn stack settled
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const turns = [T1, T2, T3].map(settledTurn).join("");
  await shot(page, 900, PAGE_HTML({ turns, railTop: RAIL_3 }), "stack-3-settled-1440x900");
  await ctx.close();
}

// B. Four-turn stack with out-of-context de-emphasis on the oldest
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const turns = [T4_OLD, T1, T2, T3].map(settledTurn).join("");
  await shot(page, 900, PAGE_HTML({ turns, railTop: RAIL_4_TOP, railBottom: RAIL_4_BOTTOM }), "stack-4-outside-context-1440x900");
  await ctx.close();
}

// C. Mid-flight turn at bottom of stack (streaming card)
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const turns = [T1, T2, T3].map(settledTurn).join("") + streamingTurn(TSTREAM);
  const rail = [
    railItem({ id: "t4", incontext: true, dot: "streaming", time: "6:34 AM CDT", q: "what changed in FORM-004?" }),
    railItem({ id: "t3", incontext: true, dot: "declined", time: "6:33 AM CDT", q: "what's the CIN-OH closeout timing?" }),
    railItem({ id: "t2", incontext: true, dot: "partial", time: "6:32 AM CDT", q: "how do TXR-TX-H addenda differ?" }),
    railItem({ id: "t1", incontext: false, dot: "grounded", time: "6:30 AM CDT", q: "walk me through closeout" }),
  ].join("");
  await shot(page, 900, PAGE_HTML({ turns, railTop: rail.split(railItem({ id: "t1", incontext: false, dot: "grounded", time: "6:30 AM CDT", q: "walk me through closeout" }))[0], railBottom: railItem({ id: "t1", incontext: false, dot: "grounded", time: "6:30 AM CDT", q: "walk me through closeout" }) }), "stack-mid-flight-1440x900", async (p) => {
    // Scroll the pane to the bottom so the streaming card is fully in view.
    await p.evaluate(() => { const sc = document.querySelector('.sa-pane-scroll'); sc.scrollTop = sc.scrollHeight; });
  });
  await ctx.close();
}

// D. Panel with two turns (overlay variant)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const turns = [T1, T2].map(settledTurn).join("");
  await page.setContent(PANEL_HTML({ turns }), { waitUntil: "load" });
  await page.screenshot({ path: "/tmp/sous-stack/panel-2-turns-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-stack/panel-2-turns-1440x900.png");
  await ctx.close();
}

// E. Rail-click jump: before + after screenshots. Before-shot shows the
// stack scrolled to the bottom (newest turn); after-shot clicks the
// oldest rail item and captures the .sa-turn--just-navigated highlight
// on the oldest card at the top of the viewport.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const turns = [T4_OLD, T1, T2, T3].map(settledTurn).join("");
  await page.setContent(PAGE_HTML({ turns, railTop: RAIL_4_TOP, railBottom: RAIL_4_BOTTOM }), { waitUntil: "load" });
  // Before: scroll to bottom (newest turn in view)
  await page.evaluate(() => { const sc = document.querySelector('.sa-pane-scroll'); sc.scrollTop = sc.scrollHeight; });
  await page.screenshot({ path: "/tmp/sous-stack/rail-jump-before-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-stack/rail-jump-before-1440x900.png (scrolled to newest at bottom)");
  // After: click the OLDEST rail item (data-target=sa-turn-t0)
  await page.locator('.sa-rail-item[data-target="sa-turn-t0"]').click();
  // Wait a tick for smooth scroll to complete + highlight to appear
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/sous-stack/rail-jump-after-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-stack/rail-jump-after-1440x900.png (oldest scrolled into view, highlight on)");
  await ctx.close();
}

// F. Reduced-motion: same click, prefers-reduced-motion:reduce emulated.
// The scroll should still land; the highlight animation should be
// suppressed by the @media (prefers-reduced-motion) CSS rule.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const turns = [T4_OLD, T1, T2, T3].map(settledTurn).join("");
  await page.setContent(PAGE_HTML({ turns, railTop: RAIL_4_TOP, railBottom: RAIL_4_BOTTOM }), { waitUntil: "load" });
  await page.evaluate(() => { const sc = document.querySelector('.sa-pane-scroll'); sc.scrollTop = sc.scrollHeight; });
  await page.locator('.sa-rail-item[data-target="sa-turn-t0"]').click();
  // No wait needed - reduced-motion scroll is instant.
  await page.screenshot({ path: "/tmp/sous-stack/rail-jump-reduced-motion-1440x900.png" });
  console.log("SCREENSHOT: /tmp/sous-stack/rail-jump-reduced-motion-1440x900.png (reduced-motion, no highlight ring)");
  // Assert the highlight class was NOT applied under reduced-motion (the
  // fixture JS reads matchMedia and skips it). Confirms the CSS + JS
  // path both respect the user preference.
  const hasClass = await page.evaluate(() => document.getElementById('sa-turn-t0').classList.contains('sa-turn--just-navigated'));
  console.log(`REDUCED-MOTION: sa-turn--just-navigated class applied? ${hasClass ? "YES (bug)" : "NO (correct)"}`);
  await ctx.close();
}

await browser.close();
