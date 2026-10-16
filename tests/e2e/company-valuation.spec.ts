import { expect, test, type Page } from "@playwright/test";

const settledStages = /^(TRAVEL_DECISION|WAITING_FOR_DICE|TRADING|TURN_END)$/;

function watchCommands(page: Page) {
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => frames.push(frame.payload.toString()));
  });
  return frames;
}

async function enterLocalGame(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  await page
    .getByRole("button", { name: "NOUVELLE PARTIE", exact: true })
    .click();
  await page.getByLabel("Type du joueur 2").selectOption("local");
  await page
    .getByRole("button", {
      name: /Choisir les places (?:financières|de marché)/,
    })
    .click();
  const setup = page.getByTestId("setup-step-markets");
  const players = setup.locator(".market-player-tabs button");
  await expect(players).toHaveCount(2);
  for (let player = 0; player < 2; player += 1) {
    await players.nth(player).click();
    await setup
      .locator(".starting-market-option")
      .filter({ hasText: "Europe" })
      .click();
  }
  await page.getByRole("button", { name: "Créer ma partie" }).click();
  await expect(
    page.getByRole("heading", { name: "Le capital vous attend." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le parquet" }).click();
  await expect(page.locator(".fund-board-canvas")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
}

async function continueCardsUntilTrading(page: Page) {
  const world = page.locator(".game-world");
  const card = page.locator(".cs-scene");
  for (let index = 0; index < 12; index += 1) {
    await expect
      .poll(
        async () =>
          (await card.isVisible().catch(() => false)) ||
          settledStages.test(
            (await world.getAttribute("data-presentation-stage")) ?? "",
          ),
        { timeout: 20_000 },
      )
      .toBeTruthy();
    if (await card.isVisible().catch(() => false)) {
      await card
        .getByRole("button", {
          name: "Continuer et appliquer les conséquences",
        })
        .click();
    } else break;
  }
  await expect(world).toHaveAttribute("data-presentation-stage", "TRADING");
  await expect(world).not.toHaveAttribute("data-effects-started", "true");
}

test("la fiche de valeur et l’abaque reflètent un achat confirmé sans modifier le portefeuille", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const frames = watchCommands(page);
  await enterLocalGame(page);
  await expect(page.locator(".game-world")).toHaveAttribute(
    "data-presentation-stage",
    "WAITING_FOR_DICE",
  );
  await page
    .locator(".turn-actions")
    .getByRole("button", { name: "Lancer le dé" })
    .click();
  await continueCardsUntilTrading(page);

  await page
    .getByLabel("Filtrer par taille de capitalisation")
    .selectOption("small");
  await page
    .getByRole("searchbox", { name: "Rechercher une entreprise" })
    .fill("Vodafone");
  const marketRow = page.locator(".td-row");
  await expect(marketRow).toHaveCount(1);
  await expect(marketRow.locator(".td-cap-category")).toHaveText("SMALL");
  await marketRow.click();
  await page
    .locator(".td-focus")
    .getByRole("button", { name: "Acheter", exact: true })
    .click();

  const companyCard = page.locator(".td-focus");
  await expect(
    companyCard.locator(".td-quote > div").nth(3).locator("strong"),
  ).toHaveText(/^1\s*\/\s*5$/);
  await expect
    .poll(
      () =>
        frames.filter(
          (frame) =>
            frame.includes("room:command") &&
            frame.includes('"type":"BUY_SHARE"'),
        ).length,
    )
    .toBe(1);
  await page
    .locator(".td-tabs")
    .getByRole("button", { name: /^Portefeuille/ })
    .click();
  const holdingRow = page.locator(".td-row").filter({ hasText: "Vodafone" });
  await expect(holdingRow).toHaveCount(1);
  await holdingRow.click();
  await expect(
    companyCard.getByRole("heading", { name: "Vodafone" }),
  ).toBeVisible();
  const sectorGrade = companyCard.getByTestId("company-sector-grade");
  await expect(sectorGrade.locator(".gf-jewel")).toHaveAttribute(
    "aria-label",
    /Secteur .* : [A-E],/,
  );
  const zoneGrade = companyCard.getByTestId("company-zone-grade").locator(".gf-jewel");
  await expect(zoneGrade).toHaveAttribute("aria-label", /Zone .* : [A-E],/);
  const zoneGradeValue = (await zoneGrade.getAttribute("aria-label"))?.match(/: ([A-E]),/)?.[1];
  const sectorGradeValue = (await sectorGrade.locator(".gf-jewel").getAttribute("aria-label"))?.match(/: ([A-E]),/)?.[1];
  expect(zoneGradeValue).toBeTruthy();
  expect(sectorGradeValue).toBeTruthy();
  const perShareIncome = companyCard.getByTestId("company-income-per-share");
  await expect(perShareIncome).toBeVisible();
  await expect(perShareIncome).toContainText(/\d/);

  const currentPrice = (
    await companyCard
      .locator(".td-quote > div")
      .nth(0)
      .locator("strong")
      .innerText()
  ).trim();
  const currentIncome = (await perShareIncome.innerText()).trim();
  const commandCountBeforeReference = frames.filter((frame) =>
    frame.includes("room:command"),
  ).length;
  const openTable = companyCard.getByRole("button", {
    name: "Abaque prix/revenu",
    exact: true,
  });
  await openTable.click();
  const dialog = page.getByRole("dialog", { name: "Abaque prix/revenu" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("grid")).toBeVisible();
  const cells = dialog.getByRole("gridcell");
  await expect(cells).toHaveCount(25);
  const currentCell = dialog.locator('[role="gridcell"][aria-current="true"]');
  await expect(currentCell).toHaveCount(1);
  await expect(currentCell).toHaveAttribute("data-zone-grade", zoneGradeValue!);
  await expect(currentCell).toHaveAttribute("data-sector-grade", sectorGradeValue!);
  await expect(currentCell).toContainText(currentPrice);
  await expect(currentCell).toContainText(currentIncome);
  const liquidationCell = dialog.locator(
    '[role="gridcell"][data-zone-grade="E"][data-sector-grade="E"]',
  );
  await expect(liquidationCell).toHaveCount(1);
  await expect(liquidationCell).toContainText("Liquidation");
  await expect(liquidationCell).toContainText(/Valeur indicative \/ part :/);
  await expect(liquidationCell).toHaveAttribute(
    "aria-label",
    /revenu par part zéro/i,
  );
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".floating-terminal")).toBeVisible();
  await expect(companyCard).toBeVisible();
  await expect(
    companyCard.locator(".td-quote > div").nth(3).locator("strong"),
  ).toHaveText(/^1\s*\/\s*5$/);
  await expect
    .poll(() => frames.filter((frame) => frame.includes("room:command")).length)
    .toBe(commandCountBeforeReference);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTable.click();
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(391);
  await dialog
    .getByRole("button", { name: "Fermer l’abaque prix/revenu", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".floating-terminal")).toBeVisible();
  await expect(
    companyCard.locator(".td-quote > div").nth(3).locator("strong"),
  ).toHaveText(/^1\s*\/\s*5$/);
  await expect
    .poll(() => frames.filter((frame) => frame.includes("room:command")).length)
    .toBe(commandCountBeforeReference);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page
    .locator(".floating-terminal")
    .getByRole("button", { name: "Terminer le marché" })
    .click();
  await expect(page.locator(".game-world")).toHaveAttribute(
    "data-presentation-stage",
    "TURN_END",
  );
  await page
    .locator(".turn-actions")
    .getByRole("button", { name: "Prochain investisseur" })
    .click();
  await expect(page.locator(".game-world")).toHaveAttribute(
    "data-presentation-stage",
    "WAITING_FOR_DICE",
  );
  await page
    .locator(".world-tools")
    .getByRole("button", { name: /^Marché/ })
    .click();
  await page
    .getByRole("searchbox", { name: "Rechercher une entreprise" })
    .fill("Vodafone");
  await expect(page.locator(".td-row")).toHaveCount(1);
  await page.locator(".td-row").click();
  await expect(
    page
      .locator(".td-focus")
      .getByRole("button", { name: "Acheter", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(
      () =>
        frames.filter((frame) => frame.includes('"type":"BUY_SHARE"')).length,
    )
    .toBe(1);
});
