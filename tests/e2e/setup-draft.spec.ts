import { expect, test } from "@playwright/test";

test("le setup retrouve les choix après retour au menu et rechargement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();

  await page.getByLabel("Nombre de joueurs").selectOption("4");
  await page.getByLabel("Nom du fonds 1").fill("Aster Capital");
  await page.getByLabel("Type du joueur 2").selectOption("local");
  await page.getByLabel("Nom du fonds 4").fill("Quatrième Fonds");
  await page.getByLabel("Difficulté de l’IA 4").selectOption("hard");
  await page.getByRole("radiogroup", { name: "Pion du joueur 4" }).getByRole("radio", { name: "Feuille" }).click();
  await page.getByRole("button", { name: /Choisir les places financières/ }).click();
  await page.getByTestId("market-player-tab-1").click();
  await page.getByTestId("market-option-asia").click();

  // Lowering the table size keeps the hidden fourth seat's settings in the draft.
  await page.getByRole("button", { name: /Configuration des fonds/ }).click();
  await page.getByLabel("Nombre de joueurs").selectOption("2");
  await page.getByLabel("Nombre de joueurs").selectOption("4");
  await expect(page.getByLabel("Nom du fonds 4")).toHaveValue("Quatrième Fonds");
  await page.getByRole("button", { name: /Choisir les places financières/ }).click();

  await page.getByRole("button", { name: "← Retour au menu" }).click();
  await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();
  await expect(page.getByTestId("setup-step-markets")).toBeVisible();
  await page.getByRole("button", { name: /Configuration des fonds/ }).click();
  await expect(page.getByLabel("Nom du fonds 1")).toHaveValue("Aster Capital");
  await expect(page.getByLabel("Type du joueur 2")).toHaveValue("local");
  await expect(page.getByLabel("Nombre de joueurs")).toHaveValue("4");
  await expect(page.getByLabel("Difficulté de l’IA 4")).toHaveValue("hard");
  await expect(page.getByRole("radiogroup", { name: "Pion du joueur 4" }).getByRole("radio", { name: "Feuille" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /Choisir les places financières/ }).click();
  await page.getByTestId("market-player-tab-1").click();

  await page.reload();
  await expect(page.getByText("Serveur connecté")).toBeVisible();
  await page.getByRole("button", { name: "NOUVELLE PARTIE", exact: true }).click();
  await expect(page.getByTestId("setup-step-funds")).toHaveCount(0);
  await expect(page.getByTestId("setup-step-markets")).toBeVisible();
  await expect(page.getByTestId("market-player-tab-1")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("market-option-asia")).toHaveAttribute("aria-pressed", "true");

  // Returning from a created lobby is the same pregame workflow used by players.
  await page.getByRole("button", { name: "Créer ma partie" }).click();
  await expect(page.getByRole("heading", { name: "Le capital vous attend." })).toBeVisible();
  await page.getByRole("button", { name: "Retour à l’accueil" }).click();
  await expect(page.getByTestId("setup-step-markets")).toBeVisible();
  await expect(page.getByTestId("market-option-asia")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Configuration des fonds/ }).click();
  await expect(page.getByLabel("Nombre de joueurs")).toHaveValue("4");
  await expect(page.getByLabel("Nom du fonds 4")).toHaveValue("Quatrième Fonds");
  await expect(page.getByLabel("Difficulté de l’IA 4")).toHaveValue("hard");
});
