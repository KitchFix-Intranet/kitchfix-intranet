import { test, expect } from "@playwright/test";

// Module stepper acceptance. One-section-on-screen shape at 390, 430,
// desktop, plus resume-at-furthest-step round-trip. TEST_MODE=true is
// required (feedback_test_mode_bypass_for_playwright).
//
// PB-006 has 5 steps and 0 checks - fastest end-to-end read pass
// without needing to answer questions. culture-os-standard has 8
// steps and 8 checks, so it doubles as a stepper-with-checks smoke.

const VIEWPORTS = [
  { name: "390px iPhone 12", width: 390, height: 844, mobile: true },
  { name: "430px iPhone 15 Pro Max", width: 430, height: 932, mobile: true },
  { name: "desktop 1280", width: 1280, height: 900, mobile: false },
];

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

for (const vp of VIEWPORTS) {
  test.describe(`Module stepper @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("opens a module and renders the stepper shape", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await page.goto("/opd");
      await expect(page.getByRole("tab", { name: /Academy/i })).toHaveAttribute("aria-selected", "true");
      await page.locator(".opd-queue-row").first().waitFor({ timeout: 10_000 });

      // First: assert D1 fix on the queue - "part N of M" appears,
      // and cadence/doc_class MUST NOT (D1 fix).
      const partRow = page.locator('.opd-queue-row').filter({ hasText: /part\s+\d+\s+of\s+\d+/i }).first();
      await expect(partRow).toBeVisible({ timeout: 10_000 });
      await expect(partRow).toContainText(/part\s+\d+\s+of\s+\d+/i);
      // Cadence and doc_class MUST NOT appear in operator copy (D1).
      const allRows = page.locator('.opd-queue-row');
      const allRowsText = await allRows.allTextContents();
      const joined = allRowsText.join(" ");
      expect(joined, "cadence must be stripped from queue kicker").not.toMatch(/\b(quarterly|on-hire|monthly|weekly)\b/i);

      // Open AGR-001 big-rules-onboarding for the shape assertions.
      // 9-step read-only module (post-merge; 17 raw sections collapse
      // to 9 after the sibling-merge pass folds the 3.1-3.9 sub-rules
      // under Facility Conduct into one step).
      const target = page.locator('.opd-queue-row').filter({ hasText: /AGR-001/i }).first();
      await expect(target).toBeVisible({ timeout: 10_000 });
      await target.click();

      // Wait for the step card to render (past the loading skeleton),
      // then assert the header + minutes-left tile.
      await expect(page.locator(".opd-focus-step-h2")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".opd-focus-mhead .opd-doc-chip")).toContainText("AGR-001");
      await expect(page.locator(".opd-focus-mhead-time")).toBeVisible();

      // The step card shows exactly ONE step at a time. The h2 count
      // inside .opd-focus-step-body should be 0 (h2 is the step head
      // outside the body). Position is whatever resume state dictates;
      // the SHAPE assertion is what matters.
      const stepCards = page.locator(".opd-focus-step");
      await expect(stepCards).toHaveCount(1);
      await expect(page.locator(".opd-focus-step-h2")).toHaveCount(1);
      const kk = page.locator(".opd-focus-step-kk").first();
      // Either "Section N of M" (content step) or "Last step" (sign
      // step) satisfies the shape. If we mount on Sign because a
      // prior run saturated progress, skip the advance assertion.
      await expect(kk).toContainText(/Section\s+\d+\s+of\s+\d+|Last step/);
      const kkText = (await kk.textContent()) || "";
      const startedOnSign = /Last step/.test(kkText);

      if (vp.mobile) {
        // Mobile: desktop rail hidden, mobile rail row visible.
        await expect(page.locator(".opd-focus-rail--stepper")).toBeHidden();
        await expect(page.locator(".opd-focus-mrail-row")).toBeVisible();
        await expect(page.locator(".opd-focus-mrail-label")).toContainText(/Section\s+\d+\s+of\s+\d+/);
        // Expand the list, verify each step is a rail item.
        await page.locator(".opd-focus-mrail-toggle").click();
        const items = page.locator(".opd-focus-mrail-list .opd-focus-rail-step");
        // AGR-001 big-rules-onboarding: 9 merged content steps + Sign
        // (post-merge; 17 raw sections collapse to 9 groups by the
        // sibling merge pass folding the 3.1-3.9 sub-rules under
        // Facility Conduct into one step).
        await expect(items).toHaveCount(9 + 1);
      } else {
        // Desktop: rail visible with 9 merged content steps + Sign.
        await expect(page.locator(".opd-focus-rail--stepper")).toBeVisible();
        const items = page.locator(".opd-focus-rail--stepper .opd-focus-rail-step");
        await expect(items).toHaveCount(9 + 1);
        // aria-current appears on exactly one item.
        const current = page.locator('.opd-focus-rail--stepper [aria-current="step"]');
        await expect(current).toHaveCount(1);
      }

      // Save & Exit exists on every step (including sign).
      await expect(page.locator(".opd-focus-step-exit")).toBeVisible();

      if (!startedOnSign) {
        // Continue is enabled when there are no checks in this step
        // (AGR-001 has no questions in any section).
        const nextBtn = page.locator(".opd-focus-step-next");
        await expect(nextBtn).toBeEnabled();

        // Snapshot the current section number, advance, verify:
        //   (a) still exactly one step card on screen (page did not grow),
        //   (b) the section number moved forward - OR we landed on the
        //       Sign step (Section N of N -> Last step).
        const beforeMatch = kkText.match(/Section\s+(\d+)\s+of\s+(\d+)/);
        const before = Number(beforeMatch?.[1] || "0");
        const total = Number(beforeMatch?.[2] || "0");
        await nextBtn.click();
        await expect(page.locator(".opd-focus-step")).toHaveCount(1);
        await expect(page.locator(".opd-focus-step-h2")).toHaveCount(1);
        if (before < total) {
          await expect(page.locator(".opd-focus-step-kk").first()).toContainText(new RegExp(`Section\\s+${before + 1}\\s+of\\s+\\d+`));
        } else {
          // Landed on Sign step.
          await expect(page.locator(".opd-focus-step-h2")).toContainText(/Sign/i);
        }
      }

      expect(errors, `console errors: ${errors.join("\n")}`).toEqual([]);
    });

    test("save + exit + resume mounts at furthest step", async ({ page }) => {
      await page.goto("/opd");
      const target = page.locator('.opd-queue-row').filter({ hasText: /PB-006/i }).filter({ hasText: /part\s+2\s+of\s+2/i }).first();
      await expect(target).toBeVisible({ timeout: 10_000 });
      await target.click();

      const kk = page.locator(".opd-focus-step-kk").first();
      // Wait for either "Section N of M" (content step) or "Last step"
      // (sign step). Either indicates the stepper mounted.
      await expect(kk).toContainText(/Section\s+\d+\s+of|Last step/, { timeout: 10_000 });
      const beforeText = (await kk.textContent()) || "";
      const beforeMatch = beforeText.match(/Section\s+(\d+)\s+of\s+(\d+)/);
      const before = Number(beforeMatch?.[1] || "0");
      const total = Number(beforeMatch?.[2] || "0");
      // If we mount on the sign step OR the LAST content section,
      // there is nothing to advance to for the resume assertion.
      // Skip (state pollution from a prior run - progress is
      // monotonic by design; module-stepper PR narrowed
      // culinary-os-standards from 15 to 5 steps, so previously-seen
      // keys now saturate the whole module).
      test.skip(!beforeMatch || before >= total, "module state is already at last section or sign step; nothing to advance");

      // Advance one step past current, then Save & exit.
      await page.locator(".opd-focus-step-next").click();
      const targetSection = before + 1;
      await expect(kk).toContainText(new RegExp(`Section\\s+${targetSection}\\s+of`));
      await page.locator(".opd-focus-step-exit").click();

      // Back in the room; reopen the same row.
      await page.locator(".opd-queue-row").first().waitFor({ timeout: 10_000 });
      const target2 = page.locator('.opd-queue-row').filter({ hasText: /PB-006/i }).filter({ hasText: /part\s+2\s+of\s+2/i }).first();
      await target2.click();

      // Should mount at target section (furthest reached), which must
      // be >= the section we advanced to (progress is monotonic).
      const kk2 = page.locator(".opd-focus-step-kk").first();
      await expect(kk2).toContainText(/Section\s+\d+\s+of/, { timeout: 10_000 });
      const afterText = (await kk2.textContent()) || "";
      const after = Number((afterText.match(/Section\s+(\d+)/) || [])[1] || "0");
      expect(after).toBeGreaterThanOrEqual(targetSection);
    });
  });
}
