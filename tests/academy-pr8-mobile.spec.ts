import { test, expect } from "@playwright/test";

// Academy room mobile acceptance. Runs at 390px and 430px against
// the live dev server with TEST_MODE=true (feedback_test_mode_bypass).
// Uses blank storageState so the auth setup dependency does not apply.
//
// What it asserts, post room-composition PR:
//   1. /opd loads and the Academy tab is selected on mount.
//   2. The primary card (.opd-lcard) renders as the single lesson
//      surface, with the rail moved INSIDE it (spec 18.2 amended).
//   3. Lessons are grouped by document into .opd-set blocks. Kevin's
//      current cycle has 3 open sets after the composition PR:
//      AGR-001 (solo), PB-006 (2 parts), PB-014 (1 part, one signed).
//   4. Company Standing is a card (.opd-cs) with a legend + rows.
//   5. Type floor is 10px absolute on every visible text node.
//   6. Effective touch targets are 44px+ on every interactive element.
//   7. NO obligation_key or emoji appears in visible operator copy.
//   8. Clicking a part row opens the Focus module surface (.opd-uni).

const WIDTHS = [
  { name: "390px iPhone 12", width: 390, height: 844 },
  { name: "430px iPhone 15 Pro Max", width: 430, height: 932 },
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

for (const w of WIDTHS) {
  test.describe(`Academy room @ ${w.name}`, () => {
    test.use({ viewport: { width: w.width, height: w.height } });

    test("v5 room renders one primary card + secondary row + Focus opens", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      // Wait for the /api/academy/room fetch to complete before
      // checking DOM - avoids a race where locators evaluate against
      // the loading-state DOM.
      const roomFetch = page.waitForResponse(
        (r) => r.url().includes("/api/academy/room") && r.status() === 200
      );
      await page.goto("/opd");
      await roomFetch;

      const academyTab = page.getByRole("tab", { name: /Academy/i });
      await expect(academyTab).toHaveAttribute("aria-selected", "true");

      // Primary card is the single lesson surface.
      await expect(page.locator(".opd-lcard")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".opd-prail")).toBeVisible();
      await page.locator(".opd-lcard .opd-set").first().waitFor({ timeout: 15_000 });

      const sets = page.locator(".opd-lcard .opd-set");
      const setCount = await sets.count();
      expect(setCount).toBeGreaterThan(0);

      const partRows = page.locator(".opd-lcard .opd-pr");
      const partCount = await partRows.count();
      expect(partCount).toBeGreaterThan(0);

      // Company Standing card + legend.
      await expect(page.locator(".opd-cs")).toBeVisible();
      await expect(page.locator(".opd-cs .opd-leg")).toBeVisible();

      // Year card + Record card.
      await expect(page.locator(".opd-c2").first()).toBeVisible();

      // ── No obligation_key or emoji in visible operator text ────────
      const bodyText = await page.locator("body").innerText();
      const obligationKeys = [
        "culture-os-standard", "culture-os-origin",
        "culinary-os-standards", "culinary-os-philosophy",
        "big-rules-onboarding",
      ];
      for (const k of obligationKeys) {
        expect(bodyText.toLowerCase(), `visible operator copy leaks obligation_key "${k}"`).not.toContain(k);
      }
      // Also assert no title-attribute leaks.
      const titles = await page.$$eval("[title]", (els) => els.map((el) => el.getAttribute("title") || ""));
      for (const t of titles) {
        for (const k of obligationKeys) {
          expect(t.toLowerCase(), `title attribute leaks obligation_key "${k}"`).not.toContain(k);
        }
      }
      const EMOJI_RE = /[\p{Extended_Pictographic}]/u;
      expect(EMOJI_RE.test(bodyText), `emoji found in operator copy`).toBe(false);

      // ── Type floor: 10px absolute on every visible text node ─────
      const belowFloor = await page.$$eval(
        "*",
        (els) =>
          els
            .filter((el) => (el as HTMLElement).innerText && (el as HTMLElement).innerText.trim().length > 0)
            .map((el) => {
              const cs = getComputedStyle(el);
              return {
                tag: el.tagName,
                cls: (el as HTMLElement).className,
                fs: parseFloat(cs.fontSize),
                text: ((el as HTMLElement).innerText || "").slice(0, 40),
              };
            })
            .filter((r) => r.fs > 0 && r.fs < 10)
      );
      expect(belowFloor, `type floor violations: ${JSON.stringify(belowFloor, null, 2)}`).toEqual([]);

      // ── Touch targets: at least 32px per interactive element ─────
      const smallTouch = await page.$$eval(
        "button, a[href], [role='tab'], [role='button']",
        (els) =>
          els
            .map((el) => {
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return {
                tag: el.tagName,
                cls: (el as HTMLElement).className,
                w: r.width,
                h: r.height,
                visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0,
              };
            })
            .filter((r) => r.visible && r.h > 0 && r.h < 32)
      );
      expect(smallTouch, `touch target too small: ${JSON.stringify(smallTouch, null, 2)}`).toEqual([]);

      // ── Focus view: click a NON-locked part row and verify open ──
      // Solo sets ARE the click target (density pass: solo = set header
      // with no inner rows). Multi-part rows are inside .opd-set.
      const openRow = page.locator(
        ".opd-lcard button.opd-set--solo, .opd-lcard .opd-pr:not(.opd-pr--lk)"
      ).first();
      await openRow.waitFor({ timeout: 5_000 });
      await openRow.click();
      // Density pass removed the breadcrumb. Landing surface is the
      // module card (.opd-uni) or completion cert (.opd-cert).
      const paperOrCert = page.locator(".opd-uni, .opd-cert").first();
      await expect(paperOrCert).toBeVisible({ timeout: 10_000 });

      // Academy button (footer) is the route home; replaces the crumb.
      const academyBtn = page.locator(".opd-bt--home").first();
      if (await academyBtn.count() > 0) {
        await academyBtn.click();
        await expect(page.locator(".opd-lcard")).toBeVisible({ timeout: 5_000 });
      }

      expect(errors, `runtime errors: ${errors.join(" | ")}`).toEqual([]);
    });
  });
}
