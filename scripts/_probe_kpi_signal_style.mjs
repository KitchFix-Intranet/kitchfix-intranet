// scripts/_probe_kpi_signal_style.mjs
//
// V34 pixel probe. /kpi/labor is auth-gated by NextAuth (TEST_MODE only
// bypasses middleware, not the SessionProvider on the client), so the
// probe runs in two parts against a `next dev` on the current branch:
//
//   PART A - synthetic-DOM injection into the real .kpi-wrap element:
//     renders four cards with the EXACT class combinations SignalCards.js
//     emits for a CLOSED-under period and an IN-PROGRESS period. This
//     lets getComputedStyle read the real CSS rules on the real page,
//     so every "want fontWeight X / fontSize Y / colour Z" assertion
//     runs against the shipped stylesheet.
//   PART B - static code read of SignalCards.js: every <SignalCard is
//     called with a `state=` prop (and none pass the deleted className
//     mechanism), every signed fact template carries a `tone` field,
//     kpi-sig-lead / -attn class strings do not appear anywhere except
//     comments.
//
// PART A verifies section B ("the CSS is pasted, not reinterpreted");
// PART B verifies section A ("state is required, one mechanism"). The
// two together are what the spec asks for.
//
// Usage: TEST_MODE=true PLAYWRIGHT_BASE_URL=http://localhost:3001 \
//        node scripts/_probe_kpi_signal_style.mjs

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const CARDS_SRC = path.join(REPO_ROOT, "src/app/kpi/labor/components/SignalCards.js");
const CSS_SRC   = path.join(REPO_ROOT, "src/app/kpi/kpi.css");
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const URL = `${BASE}/kpi/labor?account=ALL`;

// NAVY value-text colours that a signed fact must NOT resolve to.
// n-800 (#334155 = rgb(51,65,85)) is the unsigned-fact-value default.
// n-900 (#0A2548 = rgb(10,37,72)) is legacy from before V34.
const NAVY_TEXT_RGBS = new Set(["rgb(10, 37, 72)", "rgb(51, 65, 85)"]);
// Neutral (grey) stripe = --n-300. Every non-neutral card must NOT
// paint this on the ::before.
const N300_RGBS = new Set(["rgb(221, 229, 238)", "rgb(203, 213, 225)"]);

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

const CASES = [
  {
    name: "CLOSED · under (mirrors CIN - AZ 2026-07-13..2026-08-09)",
    closed: true,
    html: buildCards({
      pace:      { state: "good", pill: "ON TARGET",  hero: "▼ $1,083.39", heroTone: "good", sub: "period closed",
                   facts: [
                     ["Spent", "$14,157.86"],
                     ["Budget", "$15,241.25"],
                     ["Of budget used", "92.9%", "good"],
                     ["Left unspent", "$1,083.39", "good"],
                   ]},
      overtime:  { state: "warn", pill: "WATCH",      hero: "0.2%", heroTone: "warn", sub: "watch above 0% · off target above 8%",
                   facts: [
                     ["OT cost", "$44.07"],
                     ["Hrs to target", "53.67h", "warn"],
                     ["OT workers", "1 of 10"],
                     ["Peak OT week", "07/13 · 0.75h"],
                   ]},
      hours:     { state: "good", pill: "ON TARGET",  hero: "▼ 52.69", heroTone: "good", sub: "hours the period had left",
                   facts: [
                     ["Per week", "13.17h"],
                     ["Per worker", "1.32h"],
                     ["Budget left", "$1,083.39", "good"],
                     ["Blended rate", "$20.56/hr"],
                   ]},
      payroll:   { state: "good", pill: "FINAL",      hero: "36 of 36", heroTone: null, sub: "worker-weeks with pay data in",
                   facts: [
                     ["Unapproved hrs", "none", "good"],
                     ["Will rise", "none", "good"],
                     ["Weeks affected", "none", "good"],
                     ["Last pulled", "Aug 18"],
                   ]},
    }),
  },
  {
    name: "IN PROGRESS (mirrors CIN - AZ 2026-08-10..2026-09-06)",
    closed: false,
    html: buildCards({
      pace:      { state: "good", pill: "ON TARGET",  hero: "▼ $1,330.22", heroTone: "good", sub: "behind an even burn, 32% into the period",
                   facts: [
                     ["Spent", "$3,431.89"],
                     ["Should be at", "$4,762.11"],
                     ["Projected end", "▼ $637.40", "good"],
                     ["Left to spend", "$11,334.34"],
                   ]},
      overtime:  { state: "good", pill: "ON TARGET",  hero: "0.0%", heroTone: null, sub: "watch above 0% · off target above 8%",
                   facts: [
                     ["OT cost", "$0.00"],
                     ["Hrs to target", "13.27h", "good"],
                     ["OT workers", "0 of 8"],
                     ["Peak OT week", "—", null, true],
                   ]},
      hours:     { state: "info", pill: "ON TARGET",  hero: "547.82h", heroTone: null, sub: "you can still schedule this period",
                   facts: [
                     ["Per week", "182.61h"],
                     ["Per worker", "22.83h"],
                     ["Budget left", "$11,334.34", "good"],
                     ["Blended rate", "$20.69/hr"],
                   ]},
      payroll:   { state: "warn", pill: "PARTIAL",    hero: "10 of 12", heroTone: null, sub: "worker-weeks with pay data in",
                   action: "14.98 hrs need approval in Rippling",
                   facts: [
                     ["Unapproved hrs", "14.98h", "warn"],
                     ["Will rise", "~ $309.94", "warn"],
                     ["Weeks affected", "1"],
                     ["Last pulled", "Aug 18"],
                   ]},
    }),
  },
];

function buildCards(cards) {
  const order = ["pace", "overtime", "hours", "payroll"];
  const eyebrows = { pace: "SPENDING PACE", overtime: "OVERTIME", hours: "HOURS LEFT TO SCHEDULE", payroll: "PAYROLL DATA" };
  const closed = cards.pace.sub === "period closed";
  if (closed) eyebrows.pace = "FINAL VS BUDGET";
  return `<div class="kpi-sigs">` + order.map(k => renderCard(k, cards[k], eyebrows[k])).join("") + `</div>`;
}
function renderCard(key, c, eyebrow) {
  const facts = c.facts.map(([lab, val, tone, muted]) => `
    <div class="kpi-sig-fact">
      <div class="kpi-sig-fact-lab">${lab}</div>
      <div class="kpi-sig-fact-val ${tone ? `kpi-sig-fact-val-${tone}` : ""} ${muted ? "kpi-sig-fact-val-mute" : ""}">${val}</div>
    </div>`).join("");
  const heroCls = c.heroTone ? `kpi-sig-hero-${c.heroTone}` : "";
  return `
    <div class="kpi-sig kpi-sig-st-${c.state}" data-role="${key}">
      <div class="kpi-sig-head">
        <span class="kpi-sig-eyebrow">${eyebrow}</span>
        <span class="kpi-sig-state kpi-sig-state-${c.state}">${c.pill}</span>
      </div>
      <div class="kpi-sig-hero-lane"><span class="kpi-sig-hero-val num ${heroCls}">${c.hero}</span></div>
      <div class="kpi-sig-sub-lane">${c.sub}</div>
      ${c.action ? `<div class="kpi-sig-action-line">${c.action}</div>` : ""}
      <div class="kpi-sig-facts">${facts}</div>
    </div>`;
}

const STRIP_HTML = `
  <div class="kpi-cmp" style="margin-top: 12px;">
    <div class="kpi-cmp-title"><span class="kpi-cmp-title-lab">VS PERIOD 7</span></div>
    <div class="kpi-cmp-items">
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Blended rate</div><div class="kpi-cmp-item-val kpi-cmp-item-val-good">▼ $1.27</div></div>
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Overtime</div><div class="kpi-cmp-item-val kpi-cmp-item-val-bad">▲ 0.2 pts</div></div>
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Crew size</div><div class="kpi-cmp-item-val">0</div></div>
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Spend / week</div><div class="kpi-cmp-item-val kpi-cmp-item-val-good">▼ 7.5%</div></div>
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Hours / week</div><div class="kpi-cmp-item-val kpi-cmp-item-val-good">▼ 1.8%</div></div>
      <div class="kpi-cmp-item"><div class="kpi-cmp-item-lab">Cost / worker</div><div class="kpi-cmp-item-val kpi-cmp-item-val-good">▼ 7.5%</div></div>
    </div>
    <div class="kpi-cmp-source">PERIOD 7 · 4 wks closed</div>
  </div>`;

async function probeCase(page, c) {
  const r = await page.evaluate(({ cardsHtml, stripHtml }) => {
    const wrap = document.querySelector(".kpi-wrap");
    if (!wrap) return { hasWrap: false };
    const host = document.createElement("div");
    host.className = "kpi-app";
    host.style.cssText = "position: absolute; top: -9999px; left: 0; width: 1200px;";
    host.innerHTML = cardsHtml + stripHtml;
    wrap.appendChild(host);

    function stateClass(el, prefix) {
      const c = [...el.classList].find(x => x.startsWith(prefix));
      return c ? c.slice(prefix.length) : null;
    }
    const cards = [...host.querySelectorAll(".kpi-sig")];
    const cardRecs = cards.map(card => {
      const stripe = getComputedStyle(card, "::before");
      const eyebrow = card.querySelector(".kpi-sig-eyebrow");
      const pill = card.querySelector(".kpi-sig-state");
      const hero = card.querySelector(".kpi-sig-hero-val");
      const labs = [...card.querySelectorAll(".kpi-sig-fact-lab")];
      const vals = [...card.querySelectorAll(".kpi-sig-fact-val")];
      return {
        role: card.dataset.role,
        card_state: stateClass(card, "kpi-sig-st-"),
        pill_state: pill ? stateClass(pill, "kpi-sig-state-") : null,
        eyebrow_text: eyebrow?.textContent?.trim(),
        stripe_width: stripe.width,
        stripe_bg: stripe.backgroundColor,
        title_weight: eyebrow ? getComputedStyle(eyebrow).fontWeight : null,
        pill_weight: pill ? getComputedStyle(pill).fontWeight : null,
        hero_size: hero ? getComputedStyle(hero).fontSize : null,
        hero_weight: hero ? getComputedStyle(hero).fontWeight : null,
        sub_weight: getComputedStyle(card.querySelector(".kpi-sig-sub-lane")).fontWeight,
        lab_weights: labs.map(el => getComputedStyle(el).fontWeight),
        val_sizes:   vals.map(el => getComputedStyle(el).fontSize),
        val_weights: vals.map(el => getComputedStyle(el).fontWeight),
        val_texts:   vals.map(el => el.textContent.trim()),
        val_colors:  vals.map(el => getComputedStyle(el).color),
      };
    });

    const strip = host.querySelector(".kpi-cmp");
    const stripItems = [...strip.querySelectorAll(".kpi-cmp-item")];
    const stripRec = {
      alignItems: getComputedStyle(strip).alignItems,
      titleWeight: getComputedStyle(strip.querySelector(".kpi-cmp-title-lab")).fontWeight,
      titleColor: getComputedStyle(strip.querySelector(".kpi-cmp-title-lab")).color,
      items: stripItems.map(it => {
        const lab = it.querySelector(".kpi-cmp-item-lab");
        const val = it.querySelector(".kpi-cmp-item-val");
        const lb = Math.round(lab.getBoundingClientRect().top);
        const vb = Math.round(val.getBoundingClientRect().top);
        return {
          same: Math.abs(lb - vb) <= 2, lb, vb,
          text: val.textContent.trim(),
          labWeight: getComputedStyle(lab).fontWeight,
          valWeight: getComputedStyle(val).fontWeight,
          valSize:   getComputedStyle(val).fontSize,
        };
      }),
    };

    host.remove();
    return { hasWrap: true, cards: cardRecs, strip: stripRec };
  }, { cardsHtml: c.html, stripHtml: STRIP_HTML });

  if (!r.hasWrap) { log(`no .kpi-wrap on ${URL}`, false); return; }

  console.log(`\n[${c.name}]`);
  const allWeights = new Set();
  const nonHero800 = [];

  for (const card of r.cards) {
    console.log(`\n  ── ${card.eyebrow_text}  (card=st-${card.card_state}  pill=st-${card.pill_state}) ──`);
    log(`stripe width = ${card.stripe_width} (want 4px)`, card.stripe_width === "4px");
    const stripeNonGrey = card.card_state === "neutral" || !N300_RGBS.has(card.stripe_bg);
    log(`stripe bg    = ${card.stripe_bg} (non-grey unless neutral)`, stripeNonGrey);
    log(`title weight = ${card.title_weight} (want 700)`, card.title_weight === "700");
    log(`pill  weight = ${card.pill_weight} (want 700)`, card.pill_weight === "700");
    log(`sub   weight = ${card.sub_weight} (want 500)`, card.sub_weight === "500");
    // V35-1 - card heroes dropped one step (t-hero -> t-value). 25.2 -> 18.
    log(`hero size    = ${card.hero_size} (want 18px)`, card.hero_size === "18px");
    log(`hero weight  = ${card.hero_weight} (want 800)`, card.hero_weight === "800");
    for (let i = 0; i < card.lab_weights.length; i++) {
      log(`lab[${i}] weight = ${card.lab_weights[i]} (want 600)`, card.lab_weights[i] === "600");
    }
    for (let i = 0; i < card.val_sizes.length; i++) {
      const isMute = card.val_texts[i] === "—";
      const wantWeight = isMute ? "500" : "700";
      log(`val[${i}] size = ${card.val_sizes[i]} weight = ${card.val_weights[i]}  text="${card.val_texts[i]}"`,
          card.val_sizes[i] === "11.25px" && card.val_weights[i] === wantWeight);
    }
    for (let i = 0; i < card.val_texts.length; i++) {
      const t = card.val_texts[i];
      if (t.startsWith("▼") || t.startsWith("▲")) {
        const nonNavy = !NAVY_TEXT_RGBS.has(card.val_colors[i]);
        log(`signed val[${i}] "${t}" colour = ${card.val_colors[i]} (want non-navy)`, nonNavy);
      }
    }
    log(`card state === pill state (${card.card_state} vs ${card.pill_state})`, card.card_state && card.card_state === card.pill_state);
    if (c.closed) {
      const dashIdx = card.val_texts.findIndex(t => t === "—");
      log(`no em-dash on closed-period facts`, dashIdx === -1);
    }
    [card.title_weight, card.pill_weight, card.hero_weight, card.sub_weight, ...card.lab_weights, ...card.val_weights]
      .filter(Boolean).forEach(w => allWeights.add(w));
    if (card.title_weight === "800") nonHero800.push({ where: "title", eyebrow: card.eyebrow_text });
    if (card.pill_weight  === "800") nonHero800.push({ where: "pill",  eyebrow: card.eyebrow_text });
    if (card.sub_weight   === "800") nonHero800.push({ where: "sub",   eyebrow: card.eyebrow_text });
    card.lab_weights.forEach((w, i) => { if (w === "800") nonHero800.push({ where: `lab[${i}]`, eyebrow: card.eyebrow_text }); });
    card.val_weights.forEach((w, i) => { if (w === "800") nonHero800.push({ where: `val[${i}]`, eyebrow: card.eyebrow_text, text: card.val_texts[i] }); });
  }

  console.log(`\n  ── comparison strip ──`);
  log(`align-items = ${r.strip.alignItems} (want center)`, r.strip.alignItems === "center");
  log(`title weight = ${r.strip.titleWeight}  colour = ${r.strip.titleColor} (want 700 · purple)`,
      r.strip.titleWeight === "700" && r.strip.titleColor === "rgb(122, 62, 157)");
  for (let i = 0; i < r.strip.items.length; i++) {
    const it = r.strip.items[i];
    log(`item[${i}] lab.top=${it.lb} val.top=${it.vb} labW=${it.labWeight} valW=${it.valWeight} valSize=${it.valSize} text="${it.text}"  (want same top, lab 600, val body 700)`,
        it.same && it.labWeight === "600" && it.valWeight === "700" && it.valSize === "11.25px");
    const dbl = /^[▼▲]\s*-/.test(it.text || "");
    log(`item[${i}] no double sign in "${it.text}"`, !dbl);
  }

  console.log(`\n  ── weight discipline (all four cards) ──`);
  const expected = ["500", "600", "700", "800"];
  const set = [...allWeights].sort();
  const setOk = expected.every(w => allWeights.has(w)) && set.every(w => expected.includes(w));
  log(`distinct weights = [${set.join(", ")}] (want {500,600,700,800})`, setOk);
  log(`800 appears only on hero (${nonHero800.length} non-hero 800 sites)`, nonHero800.length === 0);
  if (nonHero800.length) for (const h of nonHero800) console.log(`      non-hero 800: ${h.where} on "${h.eyebrow}"${h.text ? ` = "${h.text}"` : ""}`);
}

function staticCodeRead() {
  console.log(`\n${"=".repeat(72)}`);
  console.log("PART B - static code read of SignalCards.js");
  console.log("=".repeat(72));
  const src = fs.readFileSync(CARDS_SRC, "utf8");
  const stripComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const openings = [...stripComments.matchAll(/<SignalCard(\s[^>]*)?>/g)];
  console.log(`  <SignalCard call sites: ${openings.length}`);
  let missingState = 0;
  for (const m of openings) {
    const attrs = m[1] || "";
    const hasState = /\bstate=/.test(attrs);
    const line = src.slice(0, m.index).split("\n").length;
    log(`SignalCards.js:${line} <SignalCard${attrs.length > 60 ? attrs.slice(0, 60) + "…" : attrs}> has state=`, hasState);
    if (!hasState) missingState++;
  }
  log(`every SignalCard call passes a state prop (${openings.length - missingState} of ${openings.length})`, missingState === 0);

  const leadRefs = [...stripComments.matchAll(/kpi-sig-lead|kpi-sig-attn/g)];
  log(`no kpi-sig-lead / kpi-sig-attn class strings remain in code (found ${leadRefs.length})`, leadRefs.length === 0);

  // CSS side: kpi-sig-st-* rules exist for all five states.
  const css = fs.readFileSync(CSS_SRC, "utf8");
  for (const s of ["good", "warn", "bad", "info", "neutral"]) {
    const has = css.includes(`.kpi-sig-st-${s}::before`);
    log(`.kpi-sig-st-${s}::before rule present in kpi.css`, has);
  }
  const stateInfoPill = css.includes(".kpi-sig-state-info");
  log(`.kpi-sig-state-info pill rule present in kpi.css`, stateInfoPill);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error(`[pageerror] ${e.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log("=".repeat(72));
  console.log("V34 signal-row + strip style-lock pixel probe");
  console.log("=".repeat(72));
  console.log("PART A - rendered CSS on synthetic-DOM injection into .kpi-wrap");
  console.log("=".repeat(72));

  await page.goto(URL, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(400);

  for (const c of CASES) await probeCase(page, c);

  staticCodeRead();

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "V34 STYLE PROBE: PASS" : `V34 STYLE PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));

  await browser.close();
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });
