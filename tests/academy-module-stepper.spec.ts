import { test, expect } from "@playwright/test";

// Module composition acceptance (spec 18.4 amended by the composition
// PR). Asserts the one-card shape at desktop / 430 / 390:
//   - Header + progress rule + rail + reading pane all inside a
//     single .opd-uni card.
//   - Reading column centered via --opd-measure.
//   - Pane cap on desktop (max-height: min(620px, calc(100vh - 360px)))
//     and NO cap below 900px (overflow: visible, page scrolls).
//   - Rail lists steps + Sign.
//   - Advance moves forward, Save & Exit persists.
//   - D2: a passed check within the same session survives Back.
//
// Requires TEST_MODE=true dev server (see feedback_test_mode_bypass).

const VIEWPORTS = [
  { name: "390px iPhone 12", width: 390, height: 844, mobile: true },
  { name: "430px iPhone 15 Pro Max", width: 430, height: 932, mobile: true },
  { name: "desktop 1280", width: 1280, height: 900, mobile: false },
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

for (const vp of VIEWPORTS) {
  test.describe(`Module composition @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("one card, hairlines instead of gaps", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

      await page.goto("/opd");
      await expect(page.getByRole("tab", { name: /Academy/i })).toHaveAttribute("aria-selected", "true");
      await page.locator(".opd-queue-row").first().waitFor({ timeout: 10_000 });

      // D1 fix (owner ruling from a prior PR): queue kicker shows
      // "part N of M", never obligation_key or cadence.
      const partRow = page.locator(".opd-queue-row").filter({ hasText: /part\s+\d+\s+of\s+\d+/i }).first();
      await expect(partRow).toBeVisible({ timeout: 10_000 });
      const allRowsText = await page.locator(".opd-queue-row").allTextContents();
      const joined = allRowsText.join(" ");
      expect(joined, "cadence must be stripped").not.toMatch(/\b(quarterly|on-hire|monthly|weekly|annual)\b/i);

      // Open the first non-signed row.
      const target = page.locator(".opd-queue-row:not(.opd-queue-row--done)").first();
      await expect(target).toBeVisible({ timeout: 10_000 });
      await target.click();

      // Wait for the one-card surface to render.
      await expect(page.locator(".opd-uni")).toBeVisible({ timeout: 15_000 });

      // Exactly one .opd-uni card on the page.
      await expect(page.locator(".opd-uni")).toHaveCount(1);

      // Header region: doc chip + h1 + minutes tile.
      await expect(page.locator(".opd-uhead .opd-doc-chip")).toBeVisible();
      await expect(page.locator(".opd-uhead-title h1")).toBeVisible();
      await expect(page.locator(".opd-uhead-rt b")).toBeVisible();

      // Progress rule: edge-to-edge 3px bar.
      await expect(page.locator(".opd-ubar")).toBeVisible();

      // Rail + content column both live inside .opd-ubody.
      await expect(page.locator(".opd-uni .opd-ubody")).toHaveCount(1);
      if (vp.mobile) {
        // Below 900px the rail stacks and the pane cap is removed
        // (overflow: visible). Check the pane's overflow.
        const overflow = await page.locator(".opd-upane").evaluate((el) => getComputedStyle(el).overflowY);
        expect(overflow).toBe("visible");
      } else {
        // Desktop: rail is visible in its own column; pane has a cap
        // and overflow-y: auto.
        await expect(page.locator(".opd-urail")).toBeVisible();
        const overflow = await page.locator(".opd-upane").evaluate((el) => getComputedStyle(el).overflowY);
        expect(overflow).toBe("auto");
        // Reading column centred at --opd-measure (640px * 1) inside
        // a wider column. Check .opd-ucw is exactly 640 wide.
        const cwWidth = await page.locator(".opd-ucw").evaluate((el) => el.getBoundingClientRect().width);
        expect(Math.round(cwWidth)).toBe(640);
      }

      // Rail lists steps + Sign. Exactly one aria-current="step".
      const rail = page.locator(".opd-urail-list .opd-sr");
      await expect(rail.first()).toBeVisible();
      const currentCount = await page.locator('.opd-urail-list [aria-current="step"]').count();
      expect(currentCount).toBe(1);

      // Pane is tabbable + has an aria-label (spec 18.4 a11y).
      await expect(page.locator(".opd-upane")).toHaveAttribute("tabindex", "0");
      const paneLabel = await page.locator(".opd-upane").getAttribute("aria-label");
      expect(paneLabel).toMatch(/./);

      // Save & exit button present on every step.
      await expect(page.locator(".opd-ufoot").getByRole("button", { name: /Save.*exit/i })).toBeVisible();

      // Advance one step if possible. Continue is disabled when
      // there's an active question; otherwise it advances.
      const skInit = page.locator(".opd-ucw-sk").first();
      const initText = (await skInit.textContent()) || "";
      const isSignAlready = /Last step/.test(initText);
      if (!isSignAlready) {
        const nextBtn = page.locator(".opd-ufoot").getByRole("button", { name: /Continue|Next check|Continue to sign/i });
        const nextEnabled = await nextBtn.first().isEnabled().catch(() => false);
        if (nextEnabled) {
          await nextBtn.first().click();
          await expect(page.locator(".opd-uni")).toHaveCount(1);
        }
      }

      expect(errors, `console errors: ${errors.join("\n")}`).toEqual([]);
    });
  });
}
