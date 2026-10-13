import { expect, test } from "@playwright/test";
import type { Session } from "@global-fund/shared";

for (const motion of ["no-preference", "reduce"] as const) {
  test(`le paiement IA exclut son revenu propre et reste lisible sans bilan intermédiaire (${motion})`, async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ reducedMotion: motion, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      const response = await page.request.post("http://127.0.0.1:3191/__test/income-fixture");
      expect(response.ok()).toBe(true);
      const { session } = await response.json() as { session: Session };
      await page.addInitScript(value => localStorage.setItem("global-fund-evolve:session", JSON.stringify(value)), session);
      await page.goto("/");
      const world = page.locator(".game-world");
      const card = page.locator(".cs-scene.is-payments");
      await expect(card).toBeVisible({ timeout: 30_000 });
      // Record committed stages so even a transient useless market ribbon fails.
      await page.evaluate(() => {
        const target = document.querySelector(".game-world")!;
        const history: string[] = [];
        (window as unknown as { incomeStages: string[] }).incomeStages = history;
        new MutationObserver(() => history.push(target.getAttribute("data-presentation-stage") ?? ""))
          .observe(target, { attributes: true, attributeFilter: ["data-presentation-stage"] });
      });
      await expect(card).toContainText("1,00 M€");
      await expect(card.locator(".cs-settlement-cash")).toHaveCount(1);
      await expect(card.locator(".cs-settlement-cash")).toContainText(/Meridian Fund.*Apex Capital/);
      await expect(card.locator(".cs-payment-list .cs-payment")).toHaveCount(0);
      await expect(card.locator(".cs-settlement-results")).not.toContainText("Banque");
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 5_000));
      await page.clock.fastForward(30_000);
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
      await page.clock.fastForward(1_000);
      await expect(world).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
      await expect(page.locator(".consequence-ribbon")).toHaveCount(0);
      // After the state commits, let the HUD number tween finish as well.
      await page.clock.runFor(600);
      const humanFund = page.locator(".investor-card").filter({ hasText: "Apex Capital" });
      const aiFund = page.locator(".investor-card").filter({ hasText: "Meridian Fund" });
      await expect(humanFund).toContainText("126,00 M€");
      await expect(aiFund).toContainText("124,00 M€");
      await expect(aiFund).toContainText("99,00 M€");
      const stages = await page.evaluate(() => (window as unknown as { incomeStages: string[] }).incomeStages);
      expect(stages).not.toContain("MARKET_IMPACT");
      expect(stages).not.toContain("PORTFOLIO_IMPACT");
      await page.screenshot({ path: `screenshots/current/income-direct-${motion}.png`, animations: "disabled" });
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
