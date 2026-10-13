import { expect, test, type Page } from "@playwright/test";

const settledStages = /^(TRAVEL_DECISION|WAITING_FOR_DICE|TRADING|TURN_END)$/;

async function startCreation(page: Page, secondSeat: "local" | "ai" = "ai") {
  await page.goto("/");
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();
  await page.getByLabel("Type du joueur 2").selectOption(secondSeat);
  await page.getByRole("button", { name: /Choisir les places (?:financières|de marché)/ }).click();
  await expect(page.getByTestId("setup-step-markets")).toBeVisible();
  await page.getByTestId("setup-step-markets").locator(".starting-market-option").filter({ hasText: "Europe" }).click();
}

async function createAndOpen(page: Page, expectedStartingMarket?: string) {
  await page.getByRole("button", { name: "Créer ma partie" }).click();
  await expect(page.getByRole("heading", { name: "Le capital vous attend." })).toBeVisible();
  if (expectedStartingMarket) await expect(page.locator(".lobby-player").first()).toContainText(expectedStartingMarket);
  await page.getByRole("button", { name: "Ouvrir le parquet" }).click();
  await expect(page.locator(".fund-board-canvas")).toHaveAttribute("data-scene-ready", "true");
  await expect(page.locator(".market-office")).toBeVisible();
}

async function continueCardsUntilSettled(page: Page) {
  const card = page.locator(".cs-scene");
  const world = page.locator(".game-world");
  const impactContinue = page.locator(".impact-continue");
  for (let count = 0; count < 12; count += 1) {
    await expect.poll(async () =>
      (await card.isVisible().catch(() => false)) ||
      (await impactContinue.isVisible().catch(() => false)) ||
      settledStages.test((await world.getAttribute("data-presentation-stage")) ?? ""),
    ).toBeTruthy();
    if (await impactContinue.isVisible().catch(() => false)) await impactContinue.click();
    else if (await card.isVisible().catch(() => false)) await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
    else break;
  }
  await expect(world).toHaveAttribute("data-presentation-stage", settledStages);
  await expect(world).not.toHaveAttribute("data-effects-started", "true");
}

async function playRollThroughMarket(page: Page) {
  await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
  await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
  await continueCardsUntilSettled(page);
  await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TRADING");
}

async function reachSecondCycleContext(page: Page) {
  for (let turn = 0; turn < 2; turn += 1) {
    await playRollThroughMarket(page);
    await page.getByRole("button", { name: "Terminer le marché" }).click();
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TURN_END");
    await page.locator(".turn-actions").getByRole("button", { name: "Prochain investisseur" }).click();
  }
  await expect(page.locator(".cs-scene.is-context")).toBeVisible({ timeout: 30_000 });
  await continueCardsUntilSettled(page);
  await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TRAVEL_DECISION");
}

const marketOptions = ["Amériques", "Europe", "Asie", "Afrique & Moyen-Orient", "Océanie"];

test.describe("Places de marché et bureaux", () => {
  test("le choix initial offre exactement cinq places et Asie devient le marché initial", async ({ page }) => {
    await startCreation(page);
    await expect(page.locator(".home-scene")).not.toContainText(/nationalité|nationality|pays du joueur/i);
    const setup = page.getByTestId("setup-step-markets");
    const options = setup.locator(".starting-market-option");
    await expect(options).toHaveCount(5);
    for (const name of marketOptions) await expect(options.filter({ hasText: name })).toHaveCount(1);
    await expect(options).toContainText(["Note C", "Note C", "Note C", "Note C", "Note C"]);

    const asia = options.filter({ hasText: "Asie" });
    await asia.click();
    await expect(asia).toHaveAttribute("aria-pressed", "true");
    await expect(asia).toContainText("Hong Kong");
    await createAndOpen(page, "Asie");

    const office = page.locator(".market-office");
    await expect(office).toHaveAttribute("data-current-market", "asia");
    await expect(office).toHaveAttribute("data-office-city", "Hong Kong");
    const playerId = await office.getAttribute("data-office-player");
    expect(playerId).toBeTruthy();
    await expect(page.locator(".world-zones .economic-zone")).toHaveCount(5);
    await expect(page.locator(".world-zones .economic-zone .rating-instrument>b")).toHaveText(["C", "C", "C", "C", "C"]);
  });

  test("le bureau du client reste attaché au fonds humain pendant le tour de l’IA", async ({ page }) => {
    test.setTimeout(75_000);
    await startCreation(page, "ai");
    const office = page.locator(".market-office");
    await createAndOpen(page);
    const humanOfficePlayer = await office.getAttribute("data-office-player");
    const humanOfficeMarket = await office.getAttribute("data-current-market");
    expect(humanOfficePlayer).toBeTruthy();
    await page.evaluate(() => {
      const tracked = window as Window & { aiOfficeFrames?: { active: string; player: string | null; market: string | null }[] };
      tracked.aiOfficeFrames = [];
      const sample = () => {
        const active = document.querySelector(".active-fund h2")?.textContent?.trim() ?? "";
        if (active !== "Meridian Fund") return;
        const room = document.querySelector(".market-office");
        tracked.aiOfficeFrames!.push({
          active,
          player: room?.getAttribute("data-office-player") ?? null,
          market: room?.getAttribute("data-current-market") ?? null,
        });
      };
      sample();
      const observer = new MutationObserver(sample);
      observer.observe(document.querySelector(".game-world")!, { childList: true, subtree: true, attributes: true });
      window.setTimeout(() => observer.disconnect(), 15_000);
    });
    await continueCardsUntilSettled(page);
    for (let turn = 0; turn < 2; turn += 1) {
      const observedFrames = await page.evaluate(() => (window as Window & { aiOfficeFrames?: unknown[] }).aiOfficeFrames?.length ?? 0);
      if (observedFrames > 0) break;
      await expect(page.locator(".active-fund h2")).toHaveText("Apex Capital");
      await playRollThroughMarket(page);
      await page.getByRole("button", { name: "Terminer le marché" }).click();
      await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TURN_END");
      await page.locator(".turn-actions").getByRole("button", { name: "Prochain investisseur" }).click();
      await expect(page.locator(".active-fund h2")).toHaveText("Meridian Fund");
      await continueCardsUntilSettled(page);
    }
    for (let step = 0; step < 60; step += 1) {
      await continueCardsUntilSettled(page);
      if ((await page.locator(".active-fund h2").innerText()).trim() === "Apex Capital") break;
      await page.waitForTimeout(250);
    }
    await expect(page.locator(".active-fund h2")).toHaveText("Apex Capital", { timeout: 5_000 });
    await expect.poll(() => page.evaluate(() => (window as Window & { aiOfficeFrames?: unknown[] }).aiOfficeFrames?.length ?? 0)).toBeGreaterThan(0);
    const frames = await page.evaluate(() => (window as Window & { aiOfficeFrames?: { active: string; player: string | null; market: string | null }[] }).aiOfficeFrames ?? []);
    expect(frames.every(frame => frame.player === humanOfficePlayer && frame.market === humanOfficeMarket)).toBe(true);
  });

  test("le bureau suit un voyage après la résolution et le fondu", async ({ page }) => {
    await startCreation(page, "local");
    const setup = page.getByTestId("setup-step-markets");
    const playerButtons = setup.locator(".market-player-tabs button");
    await playerButtons.nth(1).click();
    await expect(playerButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    const secondHumanOptions = setup.locator(".starting-market-option");
    await secondHumanOptions.filter({ hasText: "Asie" }).click();
    await playerButtons.first().click();
    await expect(playerButtons.first()).toHaveAttribute("aria-pressed", "true");
    await setup.locator(".starting-market-option").filter({ hasText: "Asie" }).click();
    await createAndOpen(page);
    await reachSecondCycleContext(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const world = page.locator(".game-world");
    await expect(world).not.toHaveClass(/motion-reduced/);

    const office = page.locator(".market-office");
    const initialPlayer = await office.getAttribute("data-office-player");
    await expect(office).toHaveAttribute("data-current-market", "asia");
    await page.getByRole("radio", { name: "Choisir Europe" }).click();
    await page.evaluate(() => {
      const world = document.querySelector(".game-world");
      if (!world) throw new Error("Game world is missing before travel.");
      const tracked = window as Window & { travelMarketsDuringResolution?: string[] };
      tracked.travelMarketsDuringResolution = [];
      let capturedResolution = false;
      const observer = new MutationObserver(() => {
        const stage = world.getAttribute("data-presentation-stage");
        if (stage !== "TRAVEL_RESOLUTION") {
          if (capturedResolution) observer.disconnect();
          return;
        }
        capturedResolution = true;
        const market = document.querySelector(".market-office")?.getAttribute("data-current-market");
        if (market) tracked.travelMarketsDuringResolution!.push(market);
      });
      observer.observe(world, { attributes: true, attributeFilter: ["data-presentation-stage"] });
    });
    await page.getByRole("button", { name: "Voyager vers Europe" }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { travelMarketsDuringResolution?: string[] }).travelMarketsDuringResolution ?? [])).toContain("asia");
    await expect(world).not.toHaveAttribute("data-presentation-stage", "TRAVEL_RESOLUTION", { timeout: 10_000 });
    await expect(world).toHaveAttribute("data-presentation-stage", "CARD_READING");
    await expect(office).toHaveAttribute("data-current-market", "europe");
    await expect(office).toHaveAttribute("data-office-city", "Londres");
    await expect(office.locator(".office-leaving")).toHaveCount(0);
    await expect(office).toHaveAttribute("data-office-player", initialPlayer!);
  });

  test("les sept colonnes se trient dans les deux sens, avec P/L inconnu en dernier et cours lisible", async ({ page }) => {
    await startCreation(page, "local");
    const setup = page.getByTestId("setup-step-markets");
    const playerButtons = setup.locator(".market-player-tabs button");
    await playerButtons.nth(1).click();
    await setup.locator(".starting-market-option").filter({ hasText: "Europe" }).click();
    await playerButtons.first().click();
    await setup.locator(".starting-market-option").filter({ hasText: "Europe" }).click();
    await createAndOpen(page);
    await playRollThroughMarket(page);

    await page.getByLabel("Filtrer par taille de capitalisation").selectOption("small");
    await page.getByRole("searchbox", { name: "Rechercher une entreprise" }).fill("Vodafone");
    const target = page.locator(".td-row");
    await expect(target).toHaveCount(1);
    await expect(target.locator(".td-cap-category")).toHaveText("SMALL");
    await target.click();
    await page.locator(".td-focus").getByRole("button", { name: "Acheter", exact: true }).click();
    const quote = page.locator(".td-focus .td-quote");
    await expect(quote.locator("div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);
    await expect(page.locator(".td-profit-loss:not(.unknown)")).toContainText("+0,0 %");
    await expect(page.locator(".td-profit-loss:not(.unknown)")).toHaveCount(1);
    await page.getByLabel("Filtrer par taille de capitalisation").selectOption("all");
    await page.getByRole("searchbox", { name: "Rechercher une entreprise" }).fill("");
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator(".td-price b").first()).toBeVisible();
    const tableViewport = await page.locator(".td-table-scroll").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left + element.clientLeft, right: rect.left + element.clientLeft + element.clientWidth, scrollLeft: element.scrollLeft };
    });
    expect(tableViewport.scrollLeft).toBe(0);
    for (const visibleColumn of [page.locator(".td-column-head > :last-child"), page.locator(".td-row").first().locator(".td-available")]) {
      const bounds = await visibleColumn.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(tableViewport.left - 2);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(tableViewport.right + 2);
    }
    const priceFont = await quote.locator(":scope > div:first-child > strong").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(priceFont).toBeGreaterThanOrEqual(18);
    await page.screenshot({ path: "screenshots/terminal-preview-1366.png", animations: "disabled" });

    const sortButtons = page.locator(".td-column-head .td-sort-button");
    await expect(sortButtons).toHaveCount(7);
    const readValues = (column: number) => page.locator(".td-row").evaluateAll((items, index) => items.map(item => {
      const cells = [".td-name b", ".td-sector", ".td-cap-category", ".td-price b", ".td-profit-loss", ".td-held", ".td-available"];
      const cell = item.querySelector(cells[index]);
      const value = index === 0 ? cell?.firstChild?.textContent?.trim() ?? "" : cell?.textContent?.trim() ?? "";
      if ((index === 2 || index === 4) && item.querySelector(index === 2 ? ".td-cap-category.unknown" : ".td-profit-loss.unknown")) return null;
      if (index === 0 || index === 1) return value.toLocaleLowerCase("fr-FR");
      if (index === 2) return ({ small: 0, medium: 1, large: 2 } as Record<string, number>)[value.toLowerCase()] ?? null;
      const negative = /[−-]/.test(value);
      const normalized = value.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
      return (Number.parseFloat(normalized) || 0) * (negative ? -1 : 1);
    }), column);

    for (let column = 0; column < 7; column += 1) {
      const button = sortButtons.nth(column);
      const header = button.locator("xpath=..");
      await button.click();
      if (await header.getAttribute("aria-sort") !== "ascending") await button.click();
      await expect(header).toHaveAttribute("aria-sort", "ascending");
      const ascending = await readValues(column);
      const known = ascending.filter((value): value is string | number => value !== null);
      const expectedAscending = [...known].sort((a, b) => typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "fr", { sensitivity: "base" }) : Number(a) - Number(b));
      expect(known).toEqual(expectedAscending);
      if (column === 4) {
        expect(ascending[0]).not.toBeNull();
        expect(ascending.slice(1).every(value => value === null)).toBe(true);
      }

      await button.click();
      await expect(header).toHaveAttribute("aria-sort", "descending");
      const descending = await readValues(column);
      const knownDescending = descending.filter((value): value is string | number => value !== null);
      const expectedDescending = [...knownDescending].sort((a, b) => typeof a === "string" && typeof b === "string" ? b.localeCompare(a, "fr", { sensitivity: "base" }) : Number(b) - Number(a));
      expect(knownDescending).toEqual(expectedDescending);
      if (column === 4) expect(descending.slice(1).every(value => value === null)).toBe(true);
    }
  });
});
