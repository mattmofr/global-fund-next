import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Session } from "@global-fund/shared";
import type { SettlementFixtureOptions } from "../fixtures/settlement.js";

const ORIGIN = "http://127.0.0.1:3191";
type FixtureResponse = { roomId: string; sessions: Session[] };

async function attach(page: Page, session: Session) {
  await page.addInitScript(value => localStorage.setItem("global-fund-evolve:session", JSON.stringify(value)), session);
  await page.goto(ORIGIN);
  await expect(page.locator(".game-world")).toBeVisible({ timeout: 30_000 });
}

async function fixture(browser: Browser, options: SettlementFixtureOptions = {}) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
  const host = await context.newPage();
  const response = await host.request.post(`${ORIGIN}/__test/settlement-fixture`, { data: options });
  expect(response.ok()).toBe(true);
  const data = await response.json() as FixtureResponse;
  await attach(host, data.sessions[0]!);
  return { context, host, sessions: data.sessions };
}

async function continueToSettlement(page: Page, holdMajor = false) {
  const desk = page.getByRole("main", { name: "Desk de règlement" });
  const card = page.locator(".cs-scene");
  const impactContinue = page.locator(".impact-continue");
  for (let step = 0; step < 12; step += 1) {
    if (await desk.isVisible().catch(() => false)) return;
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
      continue;
    }
    if (await impactContinue.isVisible().catch(() => false)) {
      await impactContinue.click();
      continue;
    }
    await page.waitForTimeout(100);
  }
  await expect(desk).toBeVisible({ timeout: 10_000 });
}

async function continueSettlementResult(page: Page) {
  const card = page.locator(".cs-scene.is-payments");
  await expect(card.getByRole("heading", { name: /Synthèse des règlements/ })).toBeVisible();
  await expect(page.locator(".consequence-ribbon")).toHaveCount(0);
  await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".settlement-desk")).toHaveCount(0);
  await expect(page.locator(".game-world")).toHaveAttribute("data-presentation-stage", /TRADING|TURN_END/);
}

async function proposeShare(page: Page) {
  const row = page.locator(".sd-assets-table tbody tr").first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Ajouter une part/ }).click();
  await page.getByRole("button", { name: /Proposer au créancier/ }).click();
}

async function openCreditor(browser: Browser, session: Session) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await attach(page, session);
  await continueToSettlement(page);
  return { context, page };
}

test.describe("Desk de règlement en direct", () => {
  test("deux créanciers payés en cash produisent une seule synthèse puis le trading", async ({ browser }) => {
    const { context, host } = await fixture(browser, { playerCount: 3, cashOnly: true });
    try {
      const card = host.locator(".cs-scene.is-payments");
      await expect(card.getByRole("heading", { name: /Synthèse des règlements — Industrie/ })).toBeVisible();
      await expect(card.locator(".cs-settlement-receipt")).toHaveCount(1);
      await expect(card.locator(".cs-global-totals")).toContainText("30,00 M€");
      const receipts = card.locator(".cs-settlement-results");
      await expect(receipts).toContainText("Meridian Fund");
      await expect(receipts).toContainText("Zenith Partners");
      await expect(card.locator(".cs-settlement-heading")).toHaveText("Revenus du secteur Industrie");
      await expect(card.locator(".cs-settlement-cash")).toHaveCount(2);
      await expect(card).not.toContainText("RÈGLEMENT ENTRE INVESTISSEURS");
      await expect(card.locator(".cs-settlement-total")).toHaveCount(0);
      await expect(card.getByRole("heading", { name: "Règlement terminé", exact: true })).toHaveCount(0);
      const cashRows = card.locator(".cs-settlement-cash");
      await expect(cashRows.nth(0)).toContainText("Apex Capital");
      await expect(cashRows.nth(0)).toContainText("Zenith Partners");
      await expect(cashRows.nth(0)).toContainText("10,00 M€");
      await expect(cashRows.nth(1)).toContainText("Apex Capital");
      await expect(cashRows.nth(1)).toContainText("Meridian Fund");
      await expect(cashRows.nth(1)).toContainText("20,00 M€");
      await expect(card).not.toContainText("Liquidités · débiteur → créancier");
      await expect(card.locator(".cs-companies")).toBeVisible();
      const order = await card.evaluate(scene => {
        const summary = scene.querySelector(".cs-settlement-results")!;
        const total = scene.querySelector(".cs-global-totals")!;
        const companies = scene.querySelector(".cs-companies")!;
        return Boolean(summary.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING)
          && Boolean(total.compareDocumentPosition(companies) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      await expect(card.locator(".cs-payment-list .cs-payment")).toHaveCount(0);
      await expect(card.locator(".cs-settlement-results")).not.toContainText("Banque");
      await host.screenshot({ path: "screenshots/current/global-cash-settlement.png", animations: "disabled" });
      await continueSettlementResult(host);
      await expect(host.locator(".fund-dock")).toContainText("97,00 M€");
    } finally { await context.close(); }
  });

  test("un créancier payé et un transfert négocié attendent une seule synthèse finale", async ({ browser }) => {
    const { context, host, sessions } = await fixture(browser, { playerCount: 3, creditorCash: 100, assetQuantity: 2, debtorCash: 12 });
    let remote: Awaited<ReturnType<typeof openCreditor>> | undefined;
    try {
      await continueToSettlement(host);
      // Zenith's debt was funded already; it must not open a receipt before the
      // remaining Meridian decision, even after a complete browser reconnection.
      await expect(host.getByRole("heading", { name: "Choisissez les actifs à céder" })).toBeVisible();
      await host.reload();
      await expect(host.getByRole("heading", { name: "Choisissez les actifs à céder" })).toBeVisible();
      await expect(host.locator(".cs-scene")).toHaveCount(0);
      await proposeShare(host);
      remote = await openCreditor(browser, sessions[1]!);
      await remote.page.getByRole("button", { name: "Accepter et payer 7,00 M€" }).click();
      const card = host.locator(".cs-scene.is-payments");
      await expect(card.getByRole("heading", { name: /Synthèse des règlements/ })).toBeVisible();
      await expect(card.locator(".cs-settlement-receipt")).toHaveCount(1);
      await expect(card.locator(".cs-global-totals")).toContainText("30,00 M€");
      const topUp = card.locator(".cs-settlement-cash").filter({ hasText: "7,00 M€" });
      await expect(topUp).toHaveCount(1);
      await expect(topUp).toContainText(/Meridian Fund.*Apex Capital/);
      await expect(card).not.toContainText("créancier → débiteur");
      await expect(card.locator(".cs-settlement-results")).toContainText("27,00 M€");
      await host.screenshot({ path: "screenshots/current/global-negotiated-settlement.png", animations: "disabled" });
      await continueSettlementResult(host);
      await expect(host.locator(".fund-dock")).toContainText("36,00 M€");
    } finally { await remote?.context.close(); await context.close(); }
  });

  test("deux décisions de financement s’enchaînent sans reçu ni sélection héritée", async ({ browser }) => {
    const { context, host, sessions } = await fixture(browser, { playerCount: 3, creditorCash: 100, assetQuantity: 2 });
    let remote: Awaited<ReturnType<typeof openCreditor>> | undefined;
    try {
      await continueToSettlement(host);
      await expect(host.locator(".sd-party-creditor")).toContainText("Zenith Partners");
      await host.locator(".sd-assets-table tbody tr").first().getByRole("button", { name: /^Ajouter une part/ }).click();
      await host.getByRole("button", { name: /Vendre au marché/ }).click();
      await expect(host.locator(".sd-party-creditor")).toContainText("Meridian Fund");
      await expect(host.locator(".cs-scene")).toHaveCount(0);
      await expect(host.locator(".consequence-ribbon")).toHaveCount(0);
      await expect(host.locator(".sd-quantity b").first()).toHaveText("0");
      await expect(host.getByRole("button", { name: /Proposer au créancier/ })).toBeDisabled();
      await proposeShare(host);
      remote = await openCreditor(browser, sessions[1]!);
      await remote.page.getByRole("button", { name: "Accepter et payer 7,00 M€" }).click();
      await expect(host.locator(".cs-settlement-receipt")).toHaveCount(1);
      await expect(host.locator(".cs-global-totals")).toContainText("30,00 M€");
      await continueSettlementResult(host);
      await expect(host.locator(".fund-dock")).toContainText("24,00 M€");
    } finally { await remote?.context.close(); await context.close(); }
  });

  test("les offres inférieure, égale et supérieure à la dette indiquent le bon sens du cash", async ({ browser }) => {
    test.setTimeout(150_000);
    const cases = [
      { label: "inférieure", options: { debtorCash: 8, assetValue: 12 as const }, cashText: "8,00 M€", payment: "Le débiteur vous verse" },
      { label: "égale", options: { debtorCash: 0, assetValue: 20 as const }, cashText: "Aucun complément en cash", payment: "Les parts couvrent exactement" },
      { label: "supérieure", options: { debtorCash: 0, assetValue: 27 as const }, cashText: "7,00 M€", payment: "Vous versez au débiteur" },
    ];
    for (const scenario of cases) {
      const { context, host, sessions } = await fixture(browser, scenario.options);
      let creditorContext: Awaited<ReturnType<typeof openCreditor>>["context"] | undefined;
      try {
        await continueToSettlement(host, true);
        await expect(host.getByText(/CASE INDUSTRIE/)).toBeVisible();
        await proposeShare(host);
        creditorContext = (await openCreditor(browser, sessions[1]!)).context;
        const creditor = creditorContext.pages()[0]!;
        await expect(creditor.getByRole("heading", { name: /Apex Capital vous propose un règlement/ })).toBeVisible();
        const offer = creditor.locator(".sd-offer-main");
        await expect(offer).toContainText(scenario.cashText);
        await expect(offer).toContainText(scenario.payment);
        if (scenario.label === "supérieure") {
          await expect(creditor.getByRole("button", { name: "Accepter et payer 7,00 M€" })).toBeEnabled();
          await creditor.getByRole("button", { name: "Accepter et payer 7,00 M€" }).click();
          await continueSettlementResult(creditor);
        } else {
          await expect(creditor.getByRole("button", { name: "Accepter le règlement" })).toBeEnabled();
          await creditor.getByRole("button", { name: "Accepter le règlement" }).click();
          await continueSettlementResult(creditor);
        }
      } finally {
        await creditorContext?.close();
        await context.close();
      }
    }
  });

  test("bloque l'acceptation si le créancier ne peut pas payer la différence et permet le refus", async ({ browser }) => {
    test.setTimeout(75_000);
    const { context, host, sessions } = await fixture(browser, { creditorCash: 4, assetValue: 27 });
    let creditorContext: Awaited<ReturnType<typeof openCreditor>>["context"] | undefined;
    try {
      await continueToSettlement(host, true);
      await proposeShare(host);
      creditorContext = (await openCreditor(browser, sessions[1]!)).context;
      const creditor = creditorContext.pages()[0]!;
      await expect(creditor.locator(".sd-cash-warning")).toContainText("Disponible : 4,00 M€");
      await expect(creditor.locator(".sd-cash-warning")).toContainText("requis : 7,00 M€");
      await expect(creditor.getByRole("button", { name: "Accepter et payer 7,00 M€" })).toBeDisabled();
      await creditor.getByRole("button", { name: "Refuser" }).click();
      await expect(host.getByRole("heading", { name: "Choisissez les actifs à céder" })).toBeVisible();
      await proposeShare(host);
      await creditor.getByRole("button", { name: "Exiger du cash" }).click();
      await continueSettlementResult(creditor);
    } finally {
      await creditorContext?.close();
      await context.close();
    }
  });

  test("permet la liquidation au marché et priorise le créancier de valorisation la plus faible", async ({ browser }) => {
    test.setTimeout(100_000);
    const liquidation = await fixture(browser, { assetValue: 27 });
    try {
      await continueToSettlement(liquidation.host, true);
      await liquidation.host.locator(".sd-assets-table tbody tr").first().getByRole("button", { name: /^Ajouter une part/ }).click();
      await liquidation.host.getByRole("button", { name: /Vendre au marché/ }).click();
      await expect(liquidation.host.locator(".settlement-desk")).toHaveCount(0);
      await continueSettlementResult(liquidation.host);
      await expect(liquidation.host.locator(".game-world")).toBeVisible();
    } finally {
      await liquidation.context.close();
    }

    const multi = await fixture(browser, { playerCount: 3 });
    try {
      await continueToSettlement(multi.host, true);
      const priority = multi.host.locator(".sd-priority");
      await expect(priority).toBeVisible();
      const entries = priority.locator(":scope > div > span");
      await expect(entries).toHaveCount(2);
      await expect(entries.nth(0)).toContainText("Zenith Partners");
      await expect(entries.nth(0)).toContainText("32,00 M€");
      await expect(entries.nth(1)).toContainText("Meridian Fund");
      await expect(entries.nth(1)).toContainText("105,00 M€");
      await expect(priority).toContainText("Valorisation au début du règlement");
    } finally {
      await multi.context.close();
    }
  });
});
