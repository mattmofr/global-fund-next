import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createServer } from "../apps/server/src/server.js";
import { installSettlementFixtureRoute } from "../tests/fixtures/install-settlement-route.js";
import type { Session } from "@global-fund/shared";
import type { SettlementFixtureOptions } from "../tests/fixtures/settlement.js";

const PAYMENT_CARD_ONLY = process.argv.includes("--payment-card-only");
const PORT = 3193;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CURRENT = resolve("screenshots/current");
const SIZED = resolve("screenshots/settlement-validation");
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

async function attach(page: Page, session: Session) {
  await page.addInitScript(value => localStorage.setItem("global-fund-evolve:session", JSON.stringify(value)), session);
  await page.goto(ORIGIN);
  await page.locator(".game-world").waitFor({ state: "visible", timeout: 30_000 });
}

async function screenshot(page: Page, name: string, viewport: typeof VIEWPORTS[number]) {
  const folder = resolve(SIZED, `${viewport.width}x${viewport.height}`);
  await mkdir(folder, { recursive: true });
  const target = resolve(folder, `${name}.png`);
  await page.screenshot({ path: target, animations: "disabled" });
  if (viewport.width === 1366) await copyFile(target, resolve(CURRENT, `${name}.png`));
  console.log(`Captured ${target}`);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function assertLayout(page: Page, errors: string[], label: string) {
  const geometry = await page.locator(".settlement-desk").evaluate(desk => {
    const footer = desk.querySelector<HTMLElement>(".sd-selection-footer, .sd-decision-footer");
    const buttons = Array.from(desk.querySelectorAll<HTMLButtonElement>("button"))
      .filter(button => button.getClientRects().length > 0)
      .map(button => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    const deskRect = desk.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      deskWidth: desk.clientWidth,
      deskScrollWidth: desk.scrollWidth,
      desk: { left: deskRect.left, right: deskRect.right, top: deskRect.top, bottom: deskRect.bottom },
      footer: footerRect ? { left: footerRect.left, right: footerRect.right, top: footerRect.top, bottom: footerRect.bottom } : null,
      buttons,
    };
  });
  const horizontalEscape = geometry.pageWidth > geometry.viewportWidth + 2 || geometry.deskScrollWidth > geometry.deskWidth + 2;
  const footerEscape = geometry.footer && (geometry.footer.left < -2 || geometry.footer.right > geometry.viewportWidth + 2 || geometry.footer.top < geometry.desk.top - 2 || geometry.footer.bottom > Math.min(geometry.viewportHeight, geometry.desk.bottom) + 2);
  const buttonEscape = geometry.buttons.some(button => button.left < -2 || button.right > geometry.viewportWidth + 2 || button.top < geometry.desk.top - 2 || button.bottom > Math.min(geometry.viewportHeight, geometry.desk.bottom) + 2);
  if (horizontalEscape || footerEscape || buttonEscape || errors.length) {
    throw new Error(`${label}: layout or browser console check failed: ${JSON.stringify({ geometry, errors })}`);
  }
}

async function createFixture(page: Page, options: SettlementFixtureOptions) {
  const response = await page.request.post(`${ORIGIN}/__test/settlement-fixture`, { data: options });
  if (!response.ok()) throw new Error(`Could not create settlement fixture (${response.status()}).`);
  return await response.json() as { roomId: string; sessions: Session[] };
}

async function continueToDesk(page: Page) {
  const desk = page.getByRole("main", { name: "Desk de règlement" });
  const card = page.locator(".cs-scene");
  const validateCoursesButton = page.getByRole("button", { name: "Valider les cours" });
  for (let step = 0; step < 12; step += 1) {
    if (await desk.isVisible().catch(() => false)) return;
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
      continue;
    }
    if (await validateCoursesButton.isVisible().catch(() => false)) {
      await validateCoursesButton.click();
      continue;
    }
    await page.waitForTimeout(100);
  }
  await desk.waitFor({ state: "visible", timeout: 10_000 });
}

async function captureSelectionAndOrdinaryOffer(browser: Browser, viewport: typeof VIEWPORTS[number]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  const host = await context.newPage();
  const hostErrors = collectErrors(host);
  try {
    let fixture = await createFixture(host, { cashOnly: true, assetValue: 12 });
    await attach(host, fixture.sessions[0]!);
    const paymentCard = host.locator(".cs-scene.is-payments");
    await paymentCard.waitFor({ state: "visible", timeout: 10_000 });
    const paymentCardDetails = await paymentCard.evaluate((scene) => {
      const header = scene.querySelector<HTMLElement>(".cs-kicker")?.textContent?.trim() ?? "";
      const label = scene.querySelector<HTMLButtonElement>(".cs-close")?.getAttribute("aria-label") ?? "";
      return {
        header: header.toLocaleUpperCase("fr-FR"),
        hasCycle: /\bcycle\b/i.test(scene.textContent ?? ""),
        hasFooter: Boolean(scene.querySelector(".cs-footer")),
        buttonCount: Array.from(scene.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.getClientRects().length > 0).length,
        closeLabel: label,
      };
    });
    if (paymentCardDetails.header !== "FLUX DE TRÉSORERIE — APEX CAPITAL" || paymentCardDetails.hasCycle || paymentCardDetails.hasFooter || paymentCardDetails.buttonCount !== 1 || paymentCardDetails.closeLabel !== "Continuer et appliquer les conséquences") {
      throw new Error(`Payment card presentation does not match the single-close contract: ${JSON.stringify(paymentCardDetails)}`);
    }
    await screenshot(host, "payment-card", viewport);
    if (PAYMENT_CARD_ONLY) return;
    fixture = await createFixture(host, { debtorCash: 8, assetValue: 12 });
    await attach(host, fixture.sessions[0]!);
    await continueToDesk(host);
    await assertLayout(host, hostErrors, `settlement ${viewport.width}`);
    await screenshot(host, "settlement", viewport);
    const row = host.locator(".sd-assets-table tbody tr").first();
    await row.getByRole("button", { name: /^Ajouter une part/ }).click();
    await assertLayout(host, hostErrors, `forced liquidation ${viewport.width}`);
    await screenshot(host, "forced-liquidation", viewport);
    await host.getByRole("button", { name: /Proposer au créancier/ }).click();

    const creditorContext = await browser.newContext({ reducedMotion: "reduce", viewport });
    try {
      const creditor = await creditorContext.newPage();
      const creditorErrors = collectErrors(creditor);
      await attach(creditor, fixture.sessions[1]!);
      await continueToDesk(creditor);
      await creditor.locator(".sd-offer-main").waitFor({ state: "visible" });
      await assertLayout(creditor, creditorErrors, `share offer ${viewport.width}`);
      await screenshot(creditor, "share-offer", viewport);
    } finally {
      await creditorContext.close();
    }
  } finally {
    await context.close();
  }
}

async function captureOverDebtOffer(browser: Browser, viewport: typeof VIEWPORTS[number]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  const host = await context.newPage();
  const hostErrors = collectErrors(host);
  try {
    const fixture = await createFixture(host, { creditorCash: 100, debtorCash: 0, assetValue: 27 });
    await attach(host, fixture.sessions[0]!);
    await continueToDesk(host);
    await assertLayout(host, hostErrors, `over debt selection ${viewport.width}`);
    await host.locator(".sd-assets-table tbody tr").first().getByRole("button", { name: /^Ajouter une part/ }).click();
    await host.getByRole("button", { name: /Proposer au créancier/ }).click();

    const creditorContext = await browser.newContext({ reducedMotion: "reduce", viewport });
    try {
      const creditor = await creditorContext.newPage();
      const creditorErrors = collectErrors(creditor);
      await attach(creditor, fixture.sessions[1]!);
      await continueToDesk(creditor);
      await creditor.locator(".sd-offer-main").waitFor({ state: "visible" });
      await assertLayout(creditor, creditorErrors, `over debt offer ${viewport.width}`);
      await screenshot(creditor, "share-offer-over-debt", viewport);
    } finally {
      await creditorContext.close();
    }
  } finally {
    await context.close();
  }
}

async function captureMultiCreditor(browser: Browser, viewport: typeof VIEWPORTS[number]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  const page = await context.newPage();
  const pageErrors = collectErrors(page);
  try {
    const fixture = await createFixture(page, { playerCount: 3 });
    await attach(page, fixture.sessions[0]!);
    await continueToDesk(page);
    await page.locator(".sd-priority").waitFor({ state: "visible" });
    await assertLayout(page, pageErrors, `multi creditor ${viewport.width}`);
    await screenshot(page, "multi-creditor-settlement", viewport);
  } finally {
    await context.close();
  }
}

delete process.env.DATABASE_URL;
process.env.PUBLIC_ORIGIN = ORIGIN;
const service = await createServer({ logger: false, storageFile: false });
installSettlementFixtureRoute(service);
await service.app.listen({ host: "127.0.0.1", port: PORT });
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(CURRENT, { recursive: true });
  for (const viewport of VIEWPORTS) {
    await captureSelectionAndOrdinaryOffer(browser, viewport);
    if (!PAYMENT_CARD_ONLY) {
      await captureOverDebtOffer(browser, viewport);
      await captureMultiCreditor(browser, viewport);
    }
  }
  if (!PAYMENT_CARD_ONLY) {
    const visuals = resolve("screenshots/visual-validation");
    const aliases: Record<string, string[]> = {
      trading: [resolve(visuals, "trading-1366x768.png"), resolve(CURRENT, "market.png")],
      "value-card": [resolve(visuals, "portfolio-1366x768.png"), resolve(CURRENT, "portfolio.png")],
      "event-newspaper": [resolve(visuals, "event-1366x768.png"), resolve(CURRENT, "event-card.png")],
      context: [resolve(visuals, "context-1366x768.png"), resolve(CURRENT, "context-impact.png")],
      analysis: [resolve(visuals, "analysis-1366x768.png"), resolve(CURRENT, "analysis.png")],
    };
    for (const [name, sources] of Object.entries(aliases)) {
      const source = sources.find(existsSync);
      if (!source) throw new Error(`Missing existing visual capture for screenshots/current/${name}.png.`);
      await copyFile(source, resolve(CURRENT, `${name}.png`));
    }
  }
} finally {
  await browser.close();
  await service.close();
}
