import { expect, test, type Page } from "@playwright/test";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function enterLobby(page: Page, secondSeat: "local" | "remote") {
  await page.goto("/");
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  if (secondSeat === "remote") {
    await page.getByRole("button", { name: "NOUVELLE PARTIE EN LIGNE", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();
    await page.getByLabel("Type du joueur 2").selectOption("local");
    await page.getByRole("button", { name: /Choisir les places financières/ }).click();
    const setup = page.getByTestId("setup-step-markets");
    const tabs = setup.locator(".market-player-tabs button");
    await expect(tabs).toHaveCount(2);
    for (let seat = 0; seat < 2; seat += 1) {
      await tabs.nth(seat).click();
      await setup.locator(".starting-market-option").filter({ hasText: "Europe" }).click();
    }
    await page.getByRole("button", { name: "Créer ma partie" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Le capital vous attend." }),
  ).toBeVisible();
  await expect(page.getByText("CODE D’INVITATION")).toBeVisible();
}

async function openParquet(page: Page) {
  await page.getByRole("button", { name: "Ouvrir le parquet" }).click();
  await expect(
    page.getByRole("heading", { name: "Le circuit des marchés" }),
  ).toBeVisible();
  await expect(page.getByText("OUVERTURE À C/C")).toBeVisible();
}

async function closeNotices(page: Page) {
  const card = page.locator(".cs-scene");
  const world = page.locator(".game-world");
  const settledStages = /^(TRAVEL_DECISION|WAITING_FOR_DICE|TRADING|TURN_END)$/;
  // Cards still require acknowledgement; market grades now finish on their own.
  for (let i = 0; i < 12; i += 1) {
    await expect.poll(async () =>
      (await card.isVisible().catch(() => false)) ||
      settledStages.test((await world.getAttribute("data-presentation-stage")) ?? ""),
    ).toBeTruthy();
    if (await card.isVisible().catch(() => false)) await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
    else break;
  }
  await expect(world).toHaveAttribute("data-presentation-stage", settledStages);
  await expect(world).not.toHaveAttribute("data-effects-started", "true");
}

test.describe("Parcours jouables", () => {
  test("les conséquences attendent le dé et le déplacement en animation normale", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await enterLobby(page, "local");
      await openParquet(page);
      await expect(page.locator(".fund-board-canvas")).toHaveAttribute("data-scene-ready", "true");
      await page.evaluate(() => {
        const timing = { clickedAt: 0, sceneAfterMs: null as number | null };
        const tracked = window as unknown as { presentationTiming: typeof timing; presentationFrames: { stage: string; dice: string; pawn: string }[] };
        tracked.presentationTiming = timing;
        tracked.presentationFrames = [];
        document.querySelector(".action-dice")!.addEventListener("click", () => { timing.clickedAt = performance.now(); }, { once: true });
        const world = document.querySelector(".game-world")!;
        const record = () => {
          const board = document.querySelector(".fund-board");
          const frame = { stage: world.getAttribute("data-presentation-stage") ?? "", dice: board?.getAttribute("data-dice-state") ?? "", pawn: board?.getAttribute("data-pawn-state") ?? "" };
          if (!tracked.presentationFrames.some((item) => item.stage === frame.stage && item.dice === frame.dice && item.pawn === frame.pawn)) tracked.presentationFrames.push(frame);
        };
        record();
        const observer = new MutationObserver(() => {
          record();
          if (timing.clickedAt && document.querySelector(".cs-scene")) {
            timing.sceneAfterMs = performance.now() - timing.clickedAt;
            observer.disconnect();
          }
        });
        observer.observe(world, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-presentation-stage", "data-dice-state", "data-pawn-state"] });
      });
      await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
      await expect(page.locator(".cs-scene")).toBeVisible({ timeout: 25_000 });
      const elapsed = await page.evaluate(() => (window as unknown as { presentationTiming: { sceneAfterMs: number | null } }).presentationTiming.sceneAfterMs);
      // La carte attend obligatoirement le dé et le déplacement.
      expect(elapsed).not.toBeNull();
      expect(elapsed!).toBeGreaterThanOrEqual(1000);
      const sequence = await page.evaluate(() => (window as unknown as { presentationFrames: { stage: string; dice: string; pawn: string }[] }).presentationFrames);
      const stages = sequence.map((frame) => frame.stage);
      expect(stages).toContain("DICE_ROLLING");
      expect(stages).toContain("DICE_RESULT");
      expect(stages).toContain("PAWN_MOVING");
      expect(stages.indexOf("DICE_ROLLING")).toBeLessThan(stages.indexOf("DICE_RESULT"));
      expect(stages.indexOf("DICE_RESULT")).toBeLessThan(stages.indexOf("PAWN_MOVING"));
      expect(sequence.find((frame) => frame.stage === "DICE_ROLLING")?.dice).toBe("rolling");
      const diceResult = sequence.find((frame) => frame.stage === "DICE_RESULT");
      expect(diceResult?.dice).toBe("stopped");
      expect(diceResult?.pawn).not.toBe("moving");
      expect(sequence.find((frame) => frame.stage === "PAWN_MOVING")?.dice).toBe("stopped");
      expect(sequence.find((frame) => frame.stage === "PAWN_MOVING")?.pawn).toBe("moving");
      await closeNotices(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("deux humains sur le même écran jouent le premier tour et passent la main", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await enterLobby(page, "local");
    await openParquet(page);

    const firstInvestor = await page.locator(".active-fund h2").innerText();
    // Une touche Espace dans un contrôle du terminal doit activer ce contrôle,
    // sans déclencher le dé du plateau derrière la fenêtre flottante.
    await page.locator(".world-tools").getByRole("button", { name: /Marché/ }).click();
    const terminalTab = page.locator(".td-tabs").getByRole("button", { name: "Marché", exact: true });
    await terminalTab.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("heading", { name: "Le circuit des marchés" })).toBeVisible();
    await expect(page.locator(".cs-scene")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".floating-terminal")).toHaveCount(0);
    // Les raccourcis de console fonctionnent aussi après restauration du
    // focus sur un bouton du HUD ; Espace garde son comportement natif.
    await page.keyboard.press("p");
    await expect(page.locator(".td-tabs button.active")).toContainText("Portefeuille");
    await page.keyboard.press("Escape");
    await page.keyboard.press("m");
    await expect(page.locator(".td-tabs button.active")).toHaveText("Marché");
    await page.keyboard.press("Escape");
    await page
      .locator(".turn-actions")
      .getByRole("button", { name: "Lancer le dé" })
      .click();

    const notice = page.getByRole("dialog");
    await expect(notice).toBeVisible();
    await expect(
      notice.getByRole("button", { name: "Continuer et appliquer les conséquences" }),
    ).toBeVisible();
    await closeNotices(page);
    await expect(
      page.getByRole("heading", { name: "Composer son portefeuille" }),
    ).toBeVisible();

      const buy = page
        .locator(".td-focus")
        .getByRole("button", { name: "Acheter", exact: true });
      await expect(buy).toBeEnabled();
      await buy.click();
      await expect(page.locator(".td-focus .td-quote > div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);

    await page.getByRole("button", { name: "Terminer le marché" }).click();
    await expect(
      page.getByRole("heading", { name: "Passage de relais" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Prochain investisseur" }).click();
    await expect(page.locator(".active-fund h2")).not.toHaveText(firstInvestor);
    expect(errors).toEqual([]);
  });

  test("un salon distant synchronise état prêt, lancement et reconnexion après rechargement", async ({
    browser,
  }) => {
    // Deux clients WebGL rendus par SwiftShader sur le serveur de test.
    test.setTimeout(75_000);
    const hostContext = await browser.newContext({ reducedMotion: "reduce" });
    const remoteContext = await browser.newContext({ reducedMotion: "reduce" });
    const host = await hostContext.newPage();
    const remote = await remoteContext.newPage();
    const hostErrors = watchErrors(host),
      remoteErrors = watchErrors(remote);
    try {
      await enterLobby(host, "remote");
      const code = (await host.locator(".room-code b").innerText()).trim();
      const openParquet = host.locator(".lobby-dock__main");
      await expect(openParquet).toBeDisabled();

      await remote.goto("/");
      await expect(remote.getByText("Serveur connecté")).toBeVisible();
      await remote.getByRole("button", { name: "REJOINDRE", exact: true }).click();
      await remote.getByLabel("Code du salon").fill(code);
      await expect(remote.getByLabel("Nom pour rejoindre")).toHaveCount(0);
      await remote.getByRole("button", { name: "Rejoindre" }).click();
      await expect(
        remote.getByRole("heading", { name: "Le capital vous attend." }),
      ).toBeVisible();
      await expect(remote.getByRole("button", { name: "Configurer le fonds 2" })).toBeVisible();
      await expect(host.getByRole("button", { name: "Configurer le fonds 1" })).toBeVisible();
      await expect(openParquet).toBeDisabled();
      await expect(host.getByRole("button", { name: /Ouvrir sans .* invité.* absent/ })).toHaveCount(0);
      await remote.getByRole("button", { name: "Configurer le fonds 2" }).click();
      const guestSettings = remote.getByRole("dialog");
      const guestName = remote.getByLabel("Nom du fonds 2");
      await guestName.fill("Meridian invité");
      await remote.getByLabel("Place de départ du fonds 2").selectOption("europe");
      await remote.getByLabel("Pion du fonds 2").selectOption("bull");
      await guestSettings.getByRole("button", { name: "Je suis prêt" }).click();
      await expect(host.getByText("Meridian invité")).toBeVisible();
      await host.getByRole("button", { name: "Configurer le fonds 1" }).click();
      const hostSettings = host.getByRole("dialog");
      await host.getByLabel("Nom du fonds 1").fill("Apex Capital");
      await host.getByLabel("Place de départ du fonds 1").selectOption("europe");
      await expect(host.getByLabel("Place de départ du fonds 1")).toHaveValue("europe");
      await expect(openParquet).toBeDisabled();
      await hostSettings.getByRole("button", { name: "Je suis prêt" }).click();
      await expect(remote.getByText("Apex Capital")).toBeVisible();
      await expect(
        host
          .locator(".lobby-player")
          .filter({ hasText: "Meridian invité" })
          .getByText("Prêt à investir"),
      ).toBeVisible();
      await expect(openParquet).toBeEnabled();
      await remote.reload();
      await expect(remote.getByText("Serveur connecté")).toBeVisible();
      await expect(remote.getByRole("heading", { name: "Le capital vous attend." })).toBeVisible();
      await remote.getByRole("button", { name: "Configurer le fonds 2" }).click();
      const reloadedGuestSettings = remote.getByRole("dialog");
      await expect(remote.getByLabel("Nom du fonds 2")).toHaveValue("Meridian invité");
      await expect(remote.getByLabel("Pion du fonds 2")).toHaveValue("bull");
      await reloadedGuestSettings.getByRole("button", { name: "Fermer", exact: true }).click();
      await expect(remote.getByTestId("lobby-seat-p2").getByText("Prêt à investir")).toBeVisible();
      await expect(host.locator(".lobby-player").filter({ hasText: "Meridian invité" }).getByText("Prêt à investir")).toBeVisible();
      await openParquet.click();
      await expect(
        host.getByRole("heading", { name: "Le circuit des marchés" }),
      ).toBeVisible();
      await expect(
        remote.getByRole("heading", { name: "Le circuit des marchés" }),
      ).toBeVisible();

      await remote.reload();
      await expect(remote.getByText("Serveur connecté")).toBeVisible();
      await expect(
        remote.getByRole("heading", { name: "Le circuit des marchés" }),
      ).toBeVisible();
      await expect(
        remote.locator(".investor-card").filter({ hasText: "Meridian invité" }),
      ).toBeVisible();
      await expect(
        host.locator(".investor-card").filter({ hasText: "Meridian invité" }),
      ).toBeVisible();

      const activeName = (
        await host.locator(".active-fund h2").innerText()
      ).trim();
      const actor = activeName === "Apex Capital" ? host : remote;
      await actor
        .locator(".turn-actions")
        .getByRole("button", { name: "Lancer le dé" })
        .click();
      await expect(host.getByRole("dialog")).toBeVisible();
      await expect(remote.getByRole("dialog")).toBeVisible();
      await closeNotices(host);
      await closeNotices(remote);
      await expect(
        host.getByRole("heading", { name: "Composer son portefeuille" }),
      ).toBeVisible();
      await expect(
        remote.getByRole("heading", { name: "Composer son portefeuille" }),
      ).toBeVisible();

      // Chaque écran affiche initialement son propre fonds. Inspecter le même
      // investisseur permet de comparer ses positions sur les deux clients.
      for (const client of [host, remote]) {
        await client
          .locator(".investor-card")
          .filter({ hasText: activeName })
          .click();
        await client.locator(".world-tools").getByRole("button", { name: /Marché/ }).click();
      }

      const companyName = (
        await actor.locator(".td-focus h2").innerText()
      ).trim();
      const buy = actor
        .locator(".td-focus")
        .getByRole("button", { name: "Acheter", exact: true });
      await expect(buy).toBeEnabled();
      // Observer le retour transitoire dès le clic, même si le rendu logiciel
      // retarde ensuite la réponse du pilote Playwright.
      await actor.evaluate(() => {
        const tracked = window as Window & { observedTradeReceipt?: string };
        tracked.observedTradeReceipt = "";
        const observer = new MutationObserver(() => {
          const receipt = document.querySelector(".trade-receipt");
          if (receipt) {
            tracked.observedTradeReceipt = receipt.textContent ?? "";
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await buy.click();
      await expect(actor.locator(".td-focus .td-quote > div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);
      await expect.poll(() => actor.evaluate(() => (window as Window & { observedTradeReceipt?: string }).observedTradeReceipt ?? "")).toContain("ACHAT VALIDÉ");
      const cashAfterTrade = await actor
        .locator(".td-capital strong")
        .innerText();
      await expect(host.locator(".td-capital strong")).toHaveText(
        cashAfterTrade,
      );
      await expect(remote.locator(".td-capital strong")).toHaveText(
        cashAfterTrade,
      );
      await expect(host.locator(".td-focus h2")).toHaveText(companyName);
      await expect(remote.locator(".td-focus h2")).toHaveText(companyName);
      await expect(host.locator(".td-focus .td-quote > div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);
      await expect(remote.locator(".td-focus .td-quote > div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);

      await remote.reload();
      await expect(remote.getByText("Serveur connecté")).toBeVisible();
      await remote
        .locator(".investor-card")
        .filter({ hasText: activeName })
        .click();
      await remote.locator(".world-tools").getByRole("button", { name: /Marché/ }).click();
      await expect(remote.locator(".td-capital strong")).toHaveText(
        cashAfterTrade,
      );
      await expect(remote.locator(".td-focus .td-quote > div").nth(3).locator("strong")).toHaveText(/^1\s*\/\s*5$/);
      expect([...hostErrors, ...remoteErrors]).toEqual([]);
    } finally {
      await remoteContext.close();
      await hostContext.close();
    }
  });

  test("l’hôte peut lancer avec une IA et une place distante absente sans renuméroter les fonds", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Serveur connecté")).toBeVisible();
    await page.getByRole("button", { name: "NOUVELLE PARTIE EN LIGNE", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Le capital vous attend." })).toBeVisible();

    const code = (await page.locator(".room-code b").innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    await expect(page.locator(".lobby-player")).toHaveCount(2);
    await expect(page.locator(".lobby-player").nth(0)).toHaveAttribute("data-testid", "lobby-seat-p1");
    await expect(page.locator(".lobby-player").nth(1)).toHaveAttribute("data-testid", "lobby-seat-p2");
    await expect(page.getByText("Place de départ à choisir")).toHaveCount(2);

    await page.getByLabel("Nombre de joueurs").selectOption("3");
    await expect(page.locator(".lobby-player")).toHaveCount(3);
    await expect(page.getByTestId("lobby-seat-p3")).toBeVisible();
    await page.getByRole("button", { name: "Configurer le fonds 3" }).click();
    await page.getByLabel("Type du fonds 3").selectOption("ai");
    await page.getByLabel("Difficulté de l’IA 3").selectOption("hard");
    const aiFundName = (await page.getByTestId("lobby-seat-p3").locator("h3").innerText()).trim();
    await page.getByRole("dialog").getByRole("button", { name: "Fermer la configuration", exact: true }).click();
    await page.getByRole("button", { name: "Configurer le fonds 1" }).click();
    await page.getByLabel("Nom du fonds 1").fill("Apex Capital");
    await page.getByLabel("Place de départ du fonds 1").selectOption("europe");

    const omitStart = page.getByRole("button", { name: /^Ouvrir sans 1 invité absent$/ });
    await expect(omitStart).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Je suis prêt" }).click();
    await expect(omitStart).toBeEnabled();

    // The absent slot is p2; the human host and AI in p3 remain the two participants.
    await expect(page.getByTestId("lobby-seat-p1")).toBeVisible();
    await expect(page.getByTestId("lobby-seat-p2")).toContainText("En attente de votre invité");
    await expect(page.getByTestId("lobby-seat-p3")).toContainText("IA");
    await omitStart.click();
    await expect(page.getByRole("heading", { name: "Le circuit des marchés" })).toBeVisible();
    await expect(page.locator(".investor-card")).toHaveCount(2);
    await expect(page.locator(".investor-card").filter({ hasText: "Apex Capital" })).toHaveCount(1);
    await expect(page.locator(".investor-card").filter({ hasText: aiFundName })).toHaveCount(1);
    await expect(page.locator(".investor-card").filter({ hasText: "Invité 2" })).toHaveCount(0);
  });

  test("sur tablette, le choix de marché initial reste utilisable sans écran modal bloquant", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await enterLobby(page, "local");
      await openParquet(page);
      await page
        .locator(".turn-actions")
        .getByRole("button", { name: "Lancer le dé" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const closeNotice = dialog.getByRole("button", {
        name: "Continuer et appliquer les conséquences",
      });
      await expect(closeNotice).toBeVisible();
      await expect(closeNotice).toBeInViewport();
      await closeNotices(page);
      await expect(
        page.getByRole("heading", { name: "Composer son portefeuille" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
