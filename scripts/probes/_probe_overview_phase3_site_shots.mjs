// USAGE (path aliases required)
// This probe does not import from `@/…` and does not need the alias hook.
// It DOES require a `next start` server running with TEST_MODE=true so
// the middleware bypass fires. Set `OVERVIEW_BASE` if not the default.
//
// scripts/probes/_probe_overview_phase3_site_shots.mjs
//
// Overview Phase 3 (PR #916 review fix - 2026-08-31). REAL site-leader
// posture capture, not the ?preview= narrowing that keeps the caller
// corporate. Uses the TEST_MODE role-injection knob added to the route
// (`?_test_role=site_leader&_test_scope=<key>`) so the resolver
// receives a genuine site-leader caller and produces the real site
// posture payload (no rail, site titles, salary control gated, no
// rev-source toggle).
//
// Kevin's rule (PR #916): "exercise the site posture directly, in
// TEST_MODE, by supplying a site-leader role to the resolver rather
// than by narrowing account access." This probe is the artefact.
//
// Cells (3):
//   1. site FYTD    - CIN - AZ, site_leader posture, FYTD
//   2. site P8      - CIN - AZ, site_leader posture, P8 2026
//   3. site P9      - CIN - AZ, site_leader posture, P9 2026
//
// Also validates the five posture-check invariants server-side (posture,
// portfolio_rail, revenue_toggle_visible, salary_toggle_visible,
// landing_account) so the PR body carries the machine-readable state
// alongside the pixels.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.OVERVIEW_BASE || "http://localhost:3312";
const OUT_DIR = "/tmp";
await mkdir(OUT_DIR, { recursive: true });

const ACCOUNT = "CIN - AZ";
const ACCOUNT_ENC = encodeURIComponent(ACCOUNT);

const shots = [
  {
    name: "overview_ph3_real_site_fytd",
    url: `/kpi/overview?account=${ACCOUNT_ENC}&start=2025-12-29&end=2026-08-31&_test_role=site_leader&_test_scope=${ACCOUNT_ENC}`,
    range: "FYTD",
  },
  {
    name: "overview_ph3_real_site_p8",
    url: `/kpi/overview?account=${ACCOUNT_ENC}&start=2026-07-13&end=2026-08-09&_test_role=site_leader&_test_scope=${ACCOUNT_ENC}`,
    range: "P8",
  },
  {
    name: "overview_ph3_real_site_p9",
    url: `/kpi/overview?account=${ACCOUNT_ENC}&start=2026-08-10&end=2026-09-06&_test_role=site_leader&_test_scope=${ACCOUNT_ENC}`,
    range: "P9",
  },
];

async function loadAndReady(page, url) {
  const respP = page.waitForResponse(
    r => r.url().includes("/api/kpi/overview") && r.request().method() === "GET",
    { timeout: 30000 },
  );
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await respP;
  return page.waitForSelector('[data-kpi-ov="board"], .kpi-statebox', { timeout: 15000 });
}

// Preflight the API to confirm the payload posture matches expectation
// before we render pixels. If the resolver refuses (403 / locked), the
// screenshot will show the refusal state; the log names why.
async function preflight(base, url) {
  const apiUrl = url.replace("/kpi/overview?", "/api/kpi/overview?");
  const r = await fetch(base + apiUrl);
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return {
    ok: true,
    posture: j.posture,
    portfolio_rail: j.posture_details?.portfolio_rail,
    revenue_toggle_visible: j.posture_details?.revenue_toggle_visible,
    salary_toggle_visible: j.posture_details?.salary_toggle_visible,
    landing_account: j.landing_account,
    payload_account: j.filters?.account,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1456, height: 900 } });

const results = [];
for (const s of shots) {
  const pre = await preflight(BASE, s.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1456, height: 900 });
  try {
    await loadAndReady(page, BASE + s.url);
    await page.waitForTimeout(500);
    const path = `${OUT_DIR}/${s.name}.png`;
    await page.screenshot({ path, fullPage: true });

    // DOM-level posture checks against the rendered board.
    const railCount = await page.locator('[data-kpi-folio="rail"], .kpi-folio-rail').count();
    const revsrcCount = await page.locator('.kpi-ov-revtog').count();
    const salaryCount = await page.locator('[data-kpi-salary-toggle], .kpi-ov-salary-toggle').count();
    const acctPill = await page.locator('.kpi-acct.on, .kpi-acct-active').count();

    results.push({
      shot: s.name,
      range: s.range,
      path,
      api: pre,
      dom: {
        folio_rail_present: railCount > 0,
        rev_source_toggle_present: revsrcCount > 0,
        salary_toggle_present: salaryCount > 0,
        account_pill_active_count: acctPill,
      },
    });
    console.log(`  captured: ${s.name}`);
  } catch (e) {
    console.log(`  FAIL   : ${s.name}   ${e.message}`);
    results.push({ shot: s.name, error: e.message, api: pre });
  } finally {
    await page.close();
  }
}

await browser.close();

// ── Summary ───────────────────────────────────────────────────────
console.log("\n" + "=".repeat(70));
console.log("Overview Phase 3 real site posture - summary");
console.log("=".repeat(70));

for (const r of results) {
  console.log(`\n${r.shot} (${r.range || "?"})`);
  console.log(`  path        : ${r.path || "-"}`);
  if (r.error) console.log(`  error       : ${r.error}`);
  if (r.api?.ok) {
    console.log(`  API posture : ${r.api.posture}                    (expected: site_leader)`);
    console.log(`  rail        : ${r.api.portfolio_rail}              (expected: false)`);
    console.log(`  rev toggle  : ${r.api.revenue_toggle_visible}      (expected: false)`);
    console.log(`  salary tog  : ${r.api.salary_toggle_visible}       (expected: true - site_leader on own account)`);
    console.log(`  landing acc : ${r.api.landing_account}             (expected: ${ACCOUNT})`);
    console.log(`  payload acc : ${r.api.payload_account}             (expected: ${ACCOUNT})`);
  } else {
    console.log(`  API         : refused (status ${r.api?.status})`);
  }
  if (r.dom) {
    console.log(`  DOM rail    : ${r.dom.folio_rail_present}          (expected: false)`);
    console.log(`  DOM revtog  : ${r.dom.rev_source_toggle_present}   (expected: false)`);
  }
}

// Verdict
const bad = results.filter(r => r.error
  || r.api?.posture !== "site_leader"
  || r.api?.portfolio_rail !== false
  || r.api?.revenue_toggle_visible !== false
  || r.api?.landing_account !== ACCOUNT
  || (r.dom && r.dom.folio_rail_present !== false)
  || (r.dom && r.dom.rev_source_toggle_present !== false));

console.log("");
console.log("=".repeat(70));
if (bad.length === 0) {
  console.log(`PASS   ${results.length}/${results.length} shots captured with real site_leader posture.`);
  process.exit(0);
} else {
  console.log(`FAIL   ${bad.length}/${results.length} shots did not clear posture checks.`);
  for (const b of bad) console.log(`         ${b.shot}: ${b.error || "posture mismatch"}`);
  process.exit(1);
}
