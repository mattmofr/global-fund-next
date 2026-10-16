import { expect, test, type Page } from "@playwright/test";

const settledStages = /^(TRAVEL_DECISION|WAITING_FOR_DICE|TRADING|TURN_END)$/;

function watchCommandFrames(page: Page) {
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => frames.push(frame.payload.toString()));
  });
  return frames;
}

async function enterLocalGame(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();
  await page.getByLabel("Type du joueur 2").selectOption("local");
  await page.getByRole("button", { name: /Choisir les places (?:financières|de marché)/ }).click();
  const setup = page.getByTestId("setup-step-markets");
  const players = setup.locator(".market-player-tabs button");
  await expect(players).toHaveCount(2);
  for (let player = 0; player < 2; player += 1) {
    await players.nth(player).click();
    await setup.locator(".starting-market-option").filter({ hasText: "Europe" }).click();
  }
  await page.getByRole("button", { name: "Créer ma partie" }).click();
  await expect(page.getByRole("heading", { name: "Le capital vous attend." })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le parquet" }).click();
  await expect(page.locator(".fund-board-canvas")).toHaveAttribute("data-scene-ready", "true");
}

async function installMarketMovingContextFixture(page: Page) {
  const roomId = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("global-fund-evolve:session") || "null") as { roomId?: string } | null;
    if (!session?.roomId) throw new Error("A test room session is required.");
    return session.roomId;
  });
  const response = await page.evaluate(async roomId => {
    const result = await fetch("/__test/context-fixture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    return { ok: result.ok, status: result.status };
  }, roomId);
  expect(response.ok, `Context fixture route returned ${response.status}`).toBeTruthy();
}

async function continueCardsUntilSettled(page: Page) {
  const world = page.locator(".game-world");
  const card = page.locator(".cs-scene");
  for (let index = 0; index < 12; index += 1) {
    await expect.poll(async () =>
      (await card.isVisible().catch(() => false)) ||
      settledStages.test((await world.getAttribute("data-presentation-stage")) ?? ""),
      { timeout: 20_000 },
    ).toBeTruthy();
    if (await card.isVisible().catch(() => false)) await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
    else break;
  }
  await expect(world).toHaveAttribute("data-presentation-stage", settledStages);
  await expect(world).not.toHaveAttribute("data-effects-started", "true");
}

async function reachSecondCycleContext(page: Page, beforeContext?: () => Promise<void>) {
  const firstInvestor = await page.locator(".active-fund h2").innerText();
  for (let turn = 0; turn < 2; turn += 1) {
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
    if (turn === 1) await expect(page.locator(".active-fund h2")).not.toHaveText(firstInvestor);
    const canvas = page.locator(".fund-board-canvas canvas");
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
    await page.locator(".fund-board-canvas").hover({ position: { x: 100, y: 100 } });
    await expect(page.locator(".fund-board-tooltip")).toHaveCount(0);
    expect(await canvas.evaluate(el => getComputedStyle(el).cursor)).not.toBe("help");
    await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
    await continueCardsUntilSettled(page);
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TRADING");
    await page.getByRole("button", { name: "Terminer le marché" }).click();
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "TURN_END");
    if (turn === 1 && beforeContext) await beforeContext();
    await page.locator(".turn-actions").getByRole("button", { name: "Prochain investisseur" }).click();
  }
  await expect(page.locator(".cs-scene.is-context")).toBeVisible({ timeout: 30_000 });
  return firstInvestor;
}

function moneyNumber(label: string | null) {
  const match = label?.match(/[\d\s.,]+/);
  if (!match) throw new Error(`Money value is missing: ${label}`);
  return Number(match[0].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
}

test.describe("Expérience du plateau", () => {
  test("la consultation libre préserve le choix du voyage et ne soumet qu’un déplacement", async ({ page }) => {
    const frames = watchCommandFrames(page);
    await enterLocalGame(page);
    const firstInvestor = await reachSecondCycleContext(page);
    await continueCardsUntilSettled(page);
    const world = page.locator(".game-world");
    await expect(world).toHaveAttribute("data-presentation-stage", "TRAVEL_DECISION");
    await expect(page.locator(".active-fund h2")).toHaveText(firstInvestor);
    const commandsBeforeConsultation = frames.filter((frame) => frame.includes("room:command")).length;

    // Les trois consoles restent consultables avant de choisir une destination.
    // Leur ouverture ne doit pas envoyer d'ordre ni masquer la décision de voyage.
    for (const [buttonName, tabName] of [[/Portefeuille/, "Portefeuille"], [/Marché/, "Marché"]] as const) {
      await page.locator(".world-tools").getByRole("button", { name: buttonName }).click();
      await expect(page.locator(".td-tabs button.active")).toContainText(tabName);
      await page.keyboard.press("Escape");
      await expect(world).toHaveAttribute("data-presentation-stage", "TRAVEL_DECISION");
    }
    await expect.poll(() => frames.filter((frame) => frame.includes("room:command")).length).toBe(commandsBeforeConsultation);

    const destinationCard = page.locator(".travel-market:not(.current-market)").first();
    const destinationButton = destinationCard.getByRole("radio");
    const destinationName = await destinationButton.locator("b").innerText();
    await destinationCard.getByRole("button", { name: /Analyser le marché/ }).click();
    await expect(page.locator(".floating-terminal")).toBeVisible();
    await expect(page.locator(".td-header h1")).toContainText(destinationName.toLocaleUpperCase("fr-FR"));
    await page.getByRole("button", { name: "Retour à la décision de voyage" }).click();
    await expect(destinationButton).toHaveAttribute("aria-checked", "false");
    await expect(world).toHaveAttribute("data-presentation-stage", "TRAVEL_DECISION");

    await destinationButton.click();
    await expect(destinationButton).toHaveAttribute("aria-checked", "true");

    await destinationCard.getByRole("button", { name: /Analyser le marché/ }).click();
    await expect(page.locator(".floating-terminal")).toBeVisible();
    await expect(page.locator(".td-header h1")).toContainText(destinationName.toLocaleUpperCase("fr-FR"));
    await page.getByLabel("Zone à consulter").selectOption({ label: destinationName });
    await expect(page.locator(".td-focus")).toContainText("Consultation libre pendant la décision de voyage");
    await expect(page.locator(".td-focus").getByRole("button", { name: "Acheter", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Retour à la décision de voyage" }).click();
    await expect(destinationButton).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".travel-choice-summary")).toContainText("1,00 M€");

    const before = await page.locator(".console-fund").locator(".animated-money").last().getAttribute("aria-label");
    await page.getByRole("button", { name: new RegExp(`Voyager vers ${destinationName}`) }).click();
    await continueCardsUntilSettled(page);
    await expect(world).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
    await expect(page.locator(".active-location")).toContainText(destinationName);
    const after = await page.locator(".console-fund").locator(".animated-money").last().getAttribute("aria-label");
    expect(moneyNumber(after)).toBeCloseTo(moneyNumber(before) - 1, 2);
    await expect.poll(() => frames.filter((frame) => frame.includes("room:command") && frame.includes('"type":"MOVE"')).length).toBe(1);
  });

  test("Échap applique la carte puis les cours se résolvent automatiquement", async ({ browser }) => {
    test.setTimeout(75_000);
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const page = await context.newPage();
    try {
      await enterLocalGame(page);
      const firstInvestor = await reachSecondCycleContext(page, () => installMarketMovingContextFixture(page));
      const world = page.locator(".game-world");
      await expect(world).toHaveAttribute("data-presentation-stage", "CARD_READING");
      await expect(world).toHaveAttribute("data-effects-started", "false");
      await expect(page.locator(".cs-footer")).toHaveCount(0);
      await expect(page.locator(".cs-scene").getByRole("button", { name: "Continuer et appliquer les conséquences" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(world).toHaveAttribute("data-presentation-stage", "MARKET_IMPACT");
      await expect(world).toHaveAttribute("data-effects-started", "true");
      await expect(page.getByRole("button", { name: "Valider les cours" })).toHaveCount(0);
      await expect(world).toHaveAttribute("data-presentation-stage", "TRAVEL_DECISION");
      await expect(page.locator(".active-fund h2")).toHaveText(firstInvestor);
      await expect(page.locator(".consequence-ribbon")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("acheter deux parts envoie une seule commande de trading", async ({ page }) => {
    const frames = watchCommandFrames(page);
    await enterLocalGame(page);
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
    await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
    await continueCardsUntilSettled(page);
    await expect(page.locator(".floating-terminal")).toBeVisible();

    await page.getByLabel("Filtrer par taille de capitalisation").selectOption("small");
    const search = page.getByRole("searchbox", { name: "Rechercher une entreprise" });
    let targetName = "";
    let cashBefore = 0;
    let sharePrice = 0;
    for (const candidate of ["Vodafone", "Volkswagen"]) {
      await search.fill(candidate);
      const candidateRow = page.locator(".td-row");
      await expect(candidateRow).toHaveCount(1);
      await expect(candidateRow.locator(".td-cap-category")).toHaveText("SMALL");
      const price = await candidateRow.locator(".td-price b").innerText();
      const cash = await page.locator(".td-capital strong").innerText();
      if (moneyNumber(cash) >= moneyNumber(price) * 2) {
        targetName = candidate;
        cashBefore = moneyNumber(cash);
        sharePrice = moneyNumber(price);
        break;
      }
    }
    expect(targetName, "Vodafone ou Volkswagen doit être une Small Cap abordable pour deux parts").not.toBe("");
    await search.fill(targetName);
    const target = page.locator(".td-row");
    await expect(target).toHaveCount(1);
    await target.click();

    const quantity = page.locator(".td-quantity");
    await expect(quantity.locator("b")).toHaveText("1");
    await quantity.getByRole("button", { name: "Augmenter la quantité" }).click();
    await expect(quantity.locator("b")).toHaveText("2");
    expect(sharePrice * 2).toBeLessThanOrEqual(cashBefore);
    await page.locator(".td-focus").getByRole("button", { name: "Acheter", exact: true }).click();
    const quotePanel = page.locator(".td-focus .td-quote");
    await expect(quotePanel.locator("div").nth(3).locator("strong")).toHaveText(/^2\s*\/\s*5$/);
    const currentPrice = await quotePanel.locator("div").nth(0).locator("strong").innerText();
    const averagePrice = await quotePanel.locator("div").nth(1).locator("strong").innerText();
    const profitLoss = await quotePanel.locator("div").nth(2).locator("strong").innerText();
    expect(moneyNumber(currentPrice)).toBeCloseTo(moneyNumber(averagePrice), 2);
    expect(profitLoss).toMatch(/^\+0,0 %$/);
    await expect.poll(async () => moneyNumber(await page.locator(".td-capital strong").innerText())).toBeCloseTo(cashBefore - sharePrice * 2, 2);
    await expect.poll(() => frames.filter((frame) => frame.includes("room:command") && frame.includes('"type":"BUY_SHARE"')).length).toBe(1);
    await expect.poll(() => frames.find((frame) => frame.includes('"type":"BUY_SHARE"')) ?? "").toContain('"quantity":2');
  });

  test("les statistiques restent dans le terminal après redimensionnement desktop", async ({ page }, testInfo) => {
    await enterLocalGame(page);
    await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", "WAITING_FOR_DICE");
    await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
    await continueCardsUntilSettled(page);
    await page.locator(".td-tabs").getByRole("button", { name: "Statistiques", exact: true }).click();
    await expect(page.locator(".td-statistics")).toBeVisible();

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".td-statistics")).toBeVisible();
      const metrics = await page.evaluate(() => {
        const terminal = document.querySelector(".floating-terminal")!;
        const statistics = document.querySelector(".td-statistics")!;
        const terminalBox = terminal.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          terminalTop: terminalBox.top,
          terminalBottom: terminalBox.bottom,
          viewportHeight: innerHeight,
          statisticsWidth: statistics.clientWidth,
          statisticsScrollWidth: statistics.scrollWidth,
          cards: Array.from(statistics.querySelectorAll(":scope > .td-card")).map((card) => {
            const box = card.getBoundingClientRect();
            return { width: box.width, height: box.height };
          }),
        };
      });
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(metrics.terminalTop).toBeGreaterThanOrEqual(0);
      expect(metrics.terminalBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
      expect(metrics.statisticsScrollWidth).toBeLessThanOrEqual(metrics.statisticsWidth + 1);
      expect(metrics.cards.length).toBeGreaterThanOrEqual(3);
      expect(metrics.cards.every((card) => card.width > 0 && card.height >= 180)).toBe(true);
    }
    const screenshotPath = testInfo.outputPath("statistics-1366x768.png");
    const screenshot = await page.screenshot({ path: screenshotPath, animations: "disabled" });
    expect(screenshot.readUInt32BE(16)).toBe(1366);
    expect(screenshot.readUInt32BE(20)).toBe(768);
  });
});
