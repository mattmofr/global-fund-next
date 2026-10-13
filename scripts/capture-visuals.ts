import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createGame, executeCommand, getGameView, priceFor } from "@global-fund/game-engine";
import type { GameState, RoomPlayer, SeatConfig, ZoneId } from "@global-fund/shared";
import { isMarketId, MARKET_IDS, PLAYER_COLORS } from "@global-fund/shared";
import { createServer } from "../apps/server/src/server.js";

const PORT = 3192;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = "visual-validation-session-only";
const ROOM_IDS = ["A11CE001", "A11CE002", "A11CE003", "A11CE004", "A11CE005", "A11CE006", "A11CE007", "A11CE008", "A11CE009", "A11CE010", "A11CE011", "A11CE012", "A11CE013", "A11CE014", "A11CE015", "A11CE016", "A11CE017"];
const OUTPUT = resolve("screenshots/visual-validation");
const CURRENT = resolve("screenshots/current");
const CURRENT_ALIASES: Record<string, string> = {
  "board-1080p": "gameplay", travel: "geography", "dice-rolling": "dice-rolling",
  "dice-result": "dice-result", "pawn-moving": "pawn-moving", "event-card": "event",
  "context-impact": "market-impact", market: "trading", portfolio: "portfolio",
  monopoly: "portfolio", analysis: "analysis", statistics: "statistics", lobby: "lobby",
};
type CaptureOptions = { reducedMotion?: boolean; quality?: "high" | "low"; measure?: boolean; panel?: "portfolio" | "analysis" | "statistics"; boardView?: boolean; setupMarkets?: boolean; expectedCardTitle?: string; presentationStage?: string; advanceCard?: boolean };
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

const fixtureSeatRows: Array<[string, string, SeatConfig["pawn"]]> = [
  ["Amara Diallo", "africa", "lion"], ["Luca Moretti", "europe", "bull"],
  ["Mei Chen", "asia", "globe"], ["Sofia Costa", "americas", "crystal"],
  ["Noah Williams", "oceania", "tower"], ["Aiko Sato", "africa", "leaf"],
];
const seats: SeatConfig[] = fixtureSeatRows.map(([name, market, pawn]) => {
  if (!isMarketId(market) || !MARKET_IDS.includes(market)) throw new Error(`Invalid fixture starting market: ${market}`);
  return { name, startingMarket: market, pawn, kind: "local", difficulty: "normal" } satisfies SeatConfig;
});

type StoredPlayer = RoomPlayer & { tokenHash: string | null };
type StoredRoom = {
  roomId: string; status: "lobby" | "playing"; hostId: string; hostPlayerId: string;
  players: StoredPlayer[]; state: GameState | null; messages: { id: string; playerId: string; name: string; text: string; createdAt: string }[];
  revision: number; commandIds: Record<string, true>; chatTimes: Record<string, number[]>;
};

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
function assertShareCaps(state: GameState) {
  for (const company of state.companies) {
    const total = Object.values(company.holdings).reduce((sum, shares) => sum + shares, 0);
    if (total > 5) throw new Error(`Fixture ownership exceeds five shares: ${company.id} (${total})`);
  }
}
function randomSeed<T>(fn: () => T): T {
  const original = Math.random;
  let seed = 0x51f15e;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  try { return fn(); } finally { Math.random = original; }
}
function executeWithSix<T>(fn: () => T): T {
  const original = Math.random;
  Math.random = () => 0.999999;
  try { return fn(); } finally { Math.random = original; }
}
function buildState(): GameState {
  const state = randomSeed(() => createGame(seats));
  state.activeIndex = 0;
  state.starterIndex = 0;
  state.initiative = seats.map((_, i) => 6 - i);
  state.cycle = 7;
  state.phase = "market";
  state.stage = "market";
  state.completedPlayers = [];
  state.players.forEach((player, i) => {
    player.zone = seats[i]!.startingMarket;
    player.sectorPosition = i * 7;
    player.geoResolved = true;
    player.cash = [185, 74, 121, 93, 216, 138][i];
  });
  state.zoneGrades = { americas: "B", europe: "A", asia: "C", africa: "D", oceania: "C" };
  state.sectorGrades = { technology: "A", finance: "B", industry: "C", health: "C", energy: "D", realestate: "B", agrifood: "C", media: "D", transport: "B" };

  // Five-share holdings across the Europe/technology cluster provide a true monopoly.
  const techCluster = state.companies.filter((company) => company.zone === "europe" && company.sector === "technology" && company.available);
  for (const company of techCluster) {
    company.holdings.p1 = 5;
    company.costBasis!.p1 = 5 * priceFor(company, state);
  }
  // Spread positions, including partial stakes, across all six funds.
  for (const [index, company] of state.companies.filter((item) => item.available).slice(4, 30).entries()) {
    const pid = `p${index % seats.length + 1}`;
    const amount = index % 8 === 0 ? 5 : index % 3 + 1;
    if (Object.values(company.holdings).reduce((sum, shares) => sum + shares, 0) + amount > 5) continue;
    company.holdings[pid] = amount;
    company.costBasis![pid] = amount * priceFor(company, state);
  }
  // Exercise the real multi-company monopoly reward as well as the single
  // technology company group. Replace earlier sample holdings in this group.
  const industryGroup = state.companies.filter((company) => company.zone === "europe" && company.sector === "industry" && company.available);
  if (industryGroup.length < 2) throw new Error("Fixture requires a multi-company Europe/industry group.");
  for (const company of industryGroup) {
    company.holdings = { p1: 5 };
    company.costBasis = { p1: 5 * priceFor(company, state) };
  }
  // Engine-derived public values are deliberately recalculated from holdings.
  const view = getGameView(state);
  state.players = view.players as typeof state.players;
  assertShareCaps(state);
  const historyState = structuredClone(state);
  historyState.cycle = 0;
  historyState.marketHistory = [];
  for (let index = 0; index < 7; index++) {
    const active = historyState.players[historyState.activeIndex]!;
    historyState.phase = "awaitNext";
    historyState.completedPlayers = historyState.players.filter((player) => player.id !== active.id).map((player) => player.id);
    const stepped = executeCommand(historyState, active.id, { type: "NEXT_TURN" });
    Object.assign(historyState, stepped);
  }
  state.marketHistory = historyState.marketHistory;
  return state;
}

function eventState(effect: "prison" | "dividend", title: string): GameState {
  const state = buildState();
  state.phase = "sector"; state.stage = "sector";
  const company = state.companies.find((item) => item.zone === "europe" && item.sector === "technology" && item.available && (item.holdings.p1 ?? 0) > 0)!;
  company.costBasis!.p1 = company.holdings.p1 * priceFor(company, state);
  const targetIndex = state.board.findIndex((cell, index) => index >= 6 && cell.kind === "event");
  state.players[0]!.sectorPosition = (targetIndex - 6 + state.board.length) % state.board.length;
  state.boardEventDeck = [{ id: `visual-${effect}`, title, story: effect === "dividend" ? "Le conseil d’administration vote une distribution exceptionnelle pour {company}." : "Une décision judiciaire ouvre une enquête sur {company}.", effect, amount: 3, targetSector: company.sector }];
  return executeWithSix(() => executeCommand(state, "p1", { type: "ROLL" }));
}

function contextState(): GameState {
  const state = buildState();
  state.phase = "awaitNext"; state.stage = "awaitNext";
  state.completedPlayers = state.players.filter((p) => p.id !== "p1").map((p) => p.id);
  state.deck.unshift({ id: "visual-context", title: "Une nouvelle frontière énergétique", type: "neutral", description: "Les investisseurs réévaluent leur exposition aux marchés de l’énergie.", changes: [{ scope: "sector", id: "energy", grade: "B" }, { scope: "zone", id: "asia", grade: "D" }] });
  return executeCommand(state, "p1", { type: "NEXT_TURN" });
}

function bearState(): GameState {
  const state = buildState();
  state.phase = "sector"; state.stage = "sector";
  const targetIndex = state.board.findIndex((cell) => cell.kind === "market" && /bear/i.test(cell.label));
  state.players[0]!.sectorPosition = (targetIndex - 6 + state.board.length) % state.board.length;
  return executeWithSix(() => executeCommand(state, "p1", { type: "ROLL" }));
}

function travelState(): GameState {
  const state = buildState();
  state.cycle = 2;
  state.phase = "geography";
  state.stage = "geography";
  state.completedPlayers = [];
  state.notices = [];
  state.players[0]!.geoResolved = false;
  state.players[0]!.jailed = false;
  return state;
}

function endingState(): GameState {
  const state = buildState();
  state.finished = true;
  state.phase = "finished";
  state.stage = "finished";
  const highest = Math.max(...state.players.map((player) => player.fundValue));
  state.winnerIds = state.players.filter((player) => player.fundValue === highest).map((player) => player.id);
  state.notices = [];
  return state;
}

function diceState(): GameState {
  const state = buildState();
  state.phase = "sector";
  state.stage = "sector";
  state.completedPlayers = [];
  state.notices = [];
  state.players[0]!.geoResolved = true;
  state.players[0]!.jailed = false;
  return state;
}

function officeState(market: ZoneId): GameState {
  const state = buildState();
  const player = state.players[0]!;
  player.startingMarket = market;
  player.currentMarket = market;
  player.zone = market;
  return state;
}

function room(roomId: string, state: GameState | null, status: StoredRoom["status"] = "playing"): StoredRoom {
  const players: StoredPlayer[] = seats.map((seat, i) => ({
    id: `p${i + 1}`, name: seat.name, kind: "local", bot: false, pawn: seat.pawn,
    startingMarket: state?.players[i]?.startingMarket ?? seat.startingMarket, difficulty: seat.difficulty, color: PLAYER_COLORS[i]!, ready: true,
    connected: false, controllerId: null, tokenHash: i === 0 ? hashToken(TOKEN) : null,
  }));
  return { roomId, status, hostId: "", hostPlayerId: "p1", players, state, messages: [], revision: 1, commandIds: {}, chatTimes: {} };
}

function fixtures(): StoredRoom[] {
  const gameplay = buildState();
  if (gameplay.board.length !== 52 || gameplay.companies.length !== 91 || gameplay.players.length !== 6) throw new Error("Visual fixture must contain 52 board cells, 91 companies, and six funds.");
  const monopoly = gameplay.companies.filter((company) => company.zone === "europe" && company.sector === "technology" && company.available);
  if (!monopoly.length || monopoly.some((company) => company.holdings.p1 !== 5)) throw new Error("Fixture does not own the complete Europe/technology group.");
  if (gameplay.marketHistory.length < 4) throw new Error("Engine did not produce enough history points for the analysis capture.");
  const playing = (index: number, state: GameState) => room(ROOM_IDS[index]!, state);
  const contexts = contextState();
  const dividend = eventState("dividend", "Dividende exceptionnel");
  const bear = bearState();
  const prison = eventState("prison", "Enquête judiciaire");
  for (const state of [gameplay, contexts, dividend, bear, prison]) assertShareCaps(state);
  if (!contexts.currentContext || !contexts.notices.some((notice) => notice.cardType === "context")) throw new Error("Context fixture was not drawn by NEXT_TURN.");
  if (!dividend.notices.some((notice) => notice.cardId === "visual-dividend")) throw new Error("Board event fixture did not execute through ROLL.");
  if (!bear.notices.some((notice) => /bear/i.test(notice.title ?? ""))) throw new Error("Market Bear fixture did not execute through ROLL.");
  if (!prison.players[0]?.jailed) throw new Error("Prison fixture did not detain the active fund through ROLL.");
  const travel = travelState();
  const ending = endingState();
  const dice = diceState();
  for (const state of [travel, ending]) assertShareCaps(state);
  assertShareCaps(dice);
  const offices = MARKET_IDS.map((market, index) => room(ROOM_IDS[index + 12]!, officeState(market)));
  return [room(ROOM_IDS[0]!, null, "lobby"), playing(1, gameplay), playing(2, gameplay), playing(3, contexts), playing(4, dividend), playing(5, bear), playing(6, prison), playing(7, travel), playing(8, ending), playing(9, dice), playing(10, dice), playing(11, dice), ...offices];
}

async function waitReady(page: Page, gameRoom: boolean, driveClockForScene = false) {
  await page.goto(ORIGIN, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(document.querySelector("#root")?.firstElementChild), { timeout: 15_000 });
  if (gameRoom) {
    if (driveClockForScene) {
      let ready = false;
      for (let elapsed = 0; elapsed <= 30_000; elapsed += 16) {
        if (await page.evaluate(() => document.querySelector(".fund-board-canvas")?.getAttribute("data-scene-ready") === "true")) {
          ready = true;
          break;
        }
        await page.clock.runFor(16);
      }
      if (!ready) throw new Error("Timed out advancing the fake clock until the board scene was ready");
    } else {
      await page.waitForFunction(() => document.querySelector(".fund-board-canvas")?.getAttribute("data-scene-ready") === "true", { timeout: 30_000 });
    }
  }
  await page.waitForTimeout(2600);
}

async function capture(browser: Browser, name: string, roomId?: string, viewport = { width: 1920, height: 1080 }, options: CaptureOptions = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
  if (options.measure) await context.addInitScript("window.__visualFrameCount = 0; (() => { const frame = () => { window.__visualFrameCount += 1; requestAnimationFrame(frame); }; requestAnimationFrame(frame); })();");
  await context.addInitScript(({ roomId: id, token, quality, reducedMotion }) => {
    if (id) localStorage.setItem("global-fund-evolve:session", JSON.stringify({ roomId: id, playerId: "p1", token }));
    if (quality || reducedMotion !== undefined) localStorage.setItem("global-fund-presentation-settings", JSON.stringify({ quality: quality ?? "high", reducedMotion: reducedMotion ?? false }));
  }, { roomId, token: TOKEN, quality: options.quality, reducedMotion: options.reducedMotion });
  const page = await context.newPage();
  if (options.presentationStage) {
    await page.clock.install({ time: new Date() });
    // Pause before navigation/Pixi setup. runFor below advances fake time
    // explicitly and leaves it paused, so slow SwiftShader work cannot consume
    // the phase while the screenshot is being rendered.
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
  }
  const errors: string[] = [];
  let portfolioInteraction: { tableViewportHeight: number; rowCount: number; firstRowVisible: boolean; secondSelectionChangedFocus: boolean; firstSelectionRestored: boolean; scrollReset: boolean } | undefined;
  let focusTicketBounds: { focusTop: number; orderBottom: number; focusBottom: number; disabledReasons: { top: number; bottom: number }[] } | undefined;
  let contextLaptopBounds: { contentTop: number; contentBottom: number; sceneBottom: number; footerAbsent: boolean; firstAfterCourse: { top: number; bottom: number }; gradeRows: { top: number; bottom: number }[] } | null | undefined;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
  await waitReady(page, Boolean(roomId && roomId !== ROOM_IDS[0]), Boolean(options.presentationStage));
  if (options.setupMarkets) {
    await page.getByRole("button", { name: /NOUVELLE PARTIE/ }).click();
    await page.getByRole("button", { name: /Choisir les places (?:financières|de marché)/ }).click();
    await page.locator('[data-testid="setup-step-markets"]').waitFor({ state: "visible" });
  }
  if (options.boardView) {
    const closeTerminal = page.getByRole("button", { name: "Retour au plateau" });
    if (await closeTerminal.isVisible().catch(() => false)) await closeTerminal.click();
    await page.waitForTimeout(900);
  } else if (options.panel === "portfolio") {
    const tab = page.locator(".td-tabs button").filter({ hasText: "Portefeuille" });
    await tab.click();
    await page.locator(".td-tabs button.active").filter({ hasText: "Portefeuille" }).waitFor({ state: "visible" });
    await page.getByText("VOS POSITIONS", { exact: true }).waitFor({ state: "visible" });
    if (viewport.width === 1366) {
      const tableViewport = page.locator(".td-table-scroll");
      const rows = page.locator(".td-row");
      const initialLayout = await tableViewport.evaluate((element) => {
        const viewportRect = element.getBoundingClientRect();
        const header = element.querySelector<HTMLElement>(".td-column-head");
        const headerRect = header?.getBoundingClientRect();
        const first = element.querySelector<HTMLElement>(".td-row");
        const rowRect = first?.getBoundingClientRect();
        const visibleTop = Math.max(viewportRect.top, headerRect?.bottom ?? viewportRect.top);
        return {
          clientHeight: element.clientHeight,
          rowCount: element.querySelectorAll(".td-row").length,
          firstRowVisible: Boolean(rowRect && rowRect.bottom > visibleTop && rowRect.top < viewportRect.bottom),
          firstName: first?.querySelector(".td-name b")?.childNodes[0]?.textContent?.trim() ?? "",
        };
      });
      if (initialLayout.clientHeight < 96 || initialLayout.rowCount < 2 || !initialLayout.firstRowVisible || !initialLayout.firstName) {
        throw new Error(`portfolio: position rows are not usable at 1366x768; metrics=${JSON.stringify(initialLayout)}`);
      }
      const secondName = await rows.nth(1).locator(".td-name b").evaluate((element) => element.childNodes[0]?.textContent?.trim() ?? "");
      await rows.nth(1).click();
      await page.waitForFunction((name) => document.querySelector(".td-focus h2")?.textContent?.trim() === name, secondName);
      const secondSelectionChangedFocus = await page.locator(".td-focus h2").textContent() === secondName;
      await tableViewport.evaluate((element) => { element.scrollTop = 0; });
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>(".td-table-scroll");
        const first = viewport?.querySelector<HTMLElement>(".td-row");
        const name = first?.querySelector<HTMLElement>(".td-name");
        const header = viewport?.querySelector<HTMLElement>(".td-column-head");
        if (!viewport || !first || !name || !header) return false;
        const viewportRect = viewport.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        const visibleTop = Math.max(viewportRect.top, header.getBoundingClientRect().bottom);
        return nameRect.top >= visibleTop - 1 && nameRect.bottom <= viewportRect.bottom + 1;
      });
      await rows.nth(0).click();
      await page.waitForFunction((name) => document.querySelector(".td-focus h2")?.textContent?.trim() === name, initialLayout.firstName);
      const firstSelectionRestored = await page.locator(".td-focus h2").textContent() === initialLayout.firstName;
      portfolioInteraction = {
        tableViewportHeight: initialLayout.clientHeight,
        rowCount: initialLayout.rowCount,
        firstRowVisible: initialLayout.firstRowVisible,
        secondSelectionChangedFocus,
        firstSelectionRestored,
        scrollReset: await tableViewport.evaluate((element) => element.scrollTop === 0),
      };
    }
  } else if (options.panel === "analysis") {
    const tab = page.locator(".td-tabs button").filter({ hasText: "Analyse" });
    await tab.click();
    await page.locator(".td-analysis").waitFor({ state: "visible" });
    await page.locator(".td-tabs button.active").filter({ hasText: "Analyse" }).waitFor({ state: "visible" });
  } else if (options.panel === "statistics") {
    const tab = page.locator(".td-tabs button").filter({ hasText: "Statistiques" });
    await tab.click();
    await page.locator(".td-statistics").waitFor({ state: "visible" });
    await page.locator(".td-tabs button.active").filter({ hasText: "Statistiques" }).waitFor({ state: "visible" });
  }
  if (options.expectedCardTitle) {
    await page.getByRole("heading", { level: 1, name: options.expectedCardTitle, exact: true }).waitFor({ state: "visible" });
  }
  if (viewport.width >= 1001 && (name === "trading" || options.panel === "portfolio")) {
    const chart = page.locator(".td-focus-details .td-price-chart");
    if (await chart.count()) {
      const readingBounds = await chart.evaluate((element) => {
        const details = element.closest<HTMLElement>(".td-focus-details")!;
        const initial = element.getBoundingClientRect();
        const pane = details.getBoundingClientRect();
        details.scrollTop += Math.max(0, initial.bottom - pane.bottom);
        const visible = element.getBoundingClientRect();
        return { paneTop: pane.top, paneBottom: pane.bottom, chartTop: visible.top, chartBottom: visible.bottom, chartHeight: visible.height };
      });
      const minimumHeight = viewport.height <= 800 ? 150 : 180;
      if (readingBounds.chartHeight < minimumHeight || readingBounds.chartTop < readingBounds.paneTop - 2 || readingBounds.chartBottom > readingBounds.paneBottom + 2) {
        throw new Error(`Historical chart cannot be read in full at ${viewport.width}x${viewport.height}: ${JSON.stringify(readingBounds)}`);
      }
    }
    focusTicketBounds = await page.locator(".td-focus").evaluate((focus) => {
      const focusRect = focus.getBoundingClientRect();
      const order = focus.querySelector<HTMLElement>(".td-focus-order");
      const orderRect = order?.getBoundingClientRect();
      const disabledReasons = Array.from(focus.querySelectorAll<HTMLElement>(".td-focus-order .td-disabled-reason"))
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
      return {
        focusTop: focusRect.top,
        orderBottom: orderRect?.bottom ?? Number.POSITIVE_INFINITY,
        focusBottom: focusRect.bottom,
        disabledReasons,
      };
    });
    if (focusTicketBounds.orderBottom > focusTicketBounds.focusBottom + 2 || focusTicketBounds.disabledReasons.some((reason) => reason.bottom > focusTicketBounds!.focusBottom + 2 || reason.top < focusTicketBounds!.focusTop - 2)) {
      errors.push(`order ticket or disabled reason escapes the visible company card: ${JSON.stringify(focusTicketBounds)}`);
    }
  }
  if (name === "context") {
    if (viewport.width >= 1001) {
      contextLaptopBounds = await page.locator(".cs-scene.is-context").evaluate((scene) => {
        const content = scene.querySelector<HTMLElement>(".cs-content");
        const afterCourse = scene.querySelector<HTMLElement>(".cs-rail > .cs-company:first-child .cs-company-data strong:nth-of-type(2)");
        if (!content || !afterCourse) return null;
        const contentRect = content.getBoundingClientRect();
        const sceneRect = scene.getBoundingClientRect();
        const afterRect = afterCourse.getBoundingClientRect();
        const gradeRows = Array.from(scene.querySelectorAll<HTMLElement>(".cs-grade-row")).map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
        return {
          contentTop: contentRect.top,
          contentBottom: contentRect.bottom,
          sceneBottom: sceneRect.bottom,
          footerAbsent: !scene.querySelector(".cs-footer"),
          firstAfterCourse: { top: afterRect.top, bottom: afterRect.bottom },
          gradeRows,
        };
      });
      const bounds = contextLaptopBounds;
      if (!bounds || !bounds.footerAbsent || bounds.gradeRows.length === 0 || bounds.firstAfterCourse.top < bounds.contentTop - 1 || bounds.firstAfterCourse.bottom > bounds.contentBottom + 1 || bounds.firstAfterCourse.bottom > bounds.sceneBottom + 1 || bounds.gradeRows.some((row) => row.top < bounds.contentTop - 1 || row.bottom > bounds.contentBottom + 1 || row.bottom > bounds.sceneBottom + 1)) {
        throw new Error(`context: grade notes or first after-price are clipped by the card content or scene bottom, or the removed footer is present at ${viewport.width}x${viewport.height}; metrics=${JSON.stringify(bounds)}`);
      }
    }
    const rail = page.locator(".cs-rail");
    const before = await rail.evaluate((el) => ({ left: el.scrollLeft, count: el.children.length, clientWidth: el.clientWidth }));
    if (before.count < 2) throw new Error("Context carousel needs multiple companies to verify horizontal scrolling");
    await rail.dispatchEvent("wheel", { deltaY: Math.max(800, before.clientWidth + 80), deltaX: 0, bubbles: true, cancelable: true });
    await page.waitForFunction((left) => Number(document.querySelector(".cs-rail")?.scrollLeft ?? 0) > left, before.left, { timeout: 5_000 });
    const after = await rail.evaluate((el) => ({ left: el.scrollLeft, count: el.children.length }));
    if (after.left <= before.left || after.count !== before.count) throw new Error(`Context wheel did not advance carousel: ${JSON.stringify({ before, after })}`);
    try { await page.waitForFunction(() => {
      const counter = document.querySelector(".cs-counter")?.textContent?.trim() ?? "";
      const active = Number(counter.split("/")[0]?.trim() ?? 0);
      return active > 1;
    }, undefined, { timeout: 5_000 }); }
    catch {
      const counter = await page.locator(".cs-counter").textContent().catch(() => null);
      throw new Error(`Context carousel moved but the active card did not change: ${JSON.stringify({ before, after, counter })}`);
    }
    await rail.evaluate((el) => { el.scrollTo({ left: 0, behavior: "instant" }); });
    await page.waitForFunction(() => Number(document.querySelector(".cs-rail")?.scrollLeft ?? 0) <= 1, undefined, { timeout: 5_000 });
  }
  if (name === "prison" || name === "bear") {
    const content = page.locator(".cs-content");
    const before = await content.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
    if (before.height > before.client + 1) {
      await content.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => {
        const el = document.querySelector(".cs-content");
        return Boolean(el && el.scrollTop > 0 && Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight);
      }, undefined, { timeout: 5_000 });
      await content.evaluate((el) => { el.scrollTo({ top: 0, behavior: "instant" }); });
      await page.waitForFunction(() => Number(document.querySelector(".cs-content")?.scrollTop ?? 0) === 0, undefined, { timeout: 5_000 });
    }
  }
  if (options.presentationStage === "DICE_ROLLING" || options.presentationStage === "DICE_RESULT" || options.presentationStage === "PAWN_MOVING") {
    await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
    let stageReached = false;
    for (let elapsed = 0; elapsed <= 15_000; elapsed += 50) {
      if (await page.locator(".game-world").getAttribute("data-presentation-stage") === options.presentationStage) {
        stageReached = true;
        break;
      }
      await page.clock.runFor(50);
    }
    if (!stageReached) throw new Error(`Timed out waiting for presentation stage ${options.presentationStage}`);
    await page.clock.runFor(16);
    if (await page.locator(".game-world").getAttribute("data-presentation-stage") !== options.presentationStage) throw new Error(`Presentation stage ${options.presentationStage} did not remain visible after the render frame`);
  }
  if (options.advanceCard && options.presentationStage) {
    await page.locator(".cs-scene").getByRole("button", { name: "Continuer et appliquer les conséquences" }).click();
    let stageReached = false;
    for (let elapsed = 0; elapsed <= 15_000; elapsed += 50) {
      const stage = await page.locator(".game-world").getAttribute("data-presentation-stage");
      const marketConfirmation = page.getByRole("button", { name: "Valider les cours" });
      if (options.presentationStage === "MARKET_IMPACT") {
        if (stage === "MARKET_IMPACT" && await marketConfirmation.isVisible().catch(() => false)) {
          stageReached = true;
          break;
        }

      } else if (stage === options.presentationStage) {
        stageReached = true;
        break;
      }
      await page.clock.runFor(50);
    }
    if (!stageReached) throw new Error(`Timed out waiting for presentation stage ${options.presentationStage}`);
    await page.clock.runFor(16);
    if (await page.locator(".game-world").getAttribute("data-presentation-stage") !== options.presentationStage) throw new Error(`Presentation stage ${options.presentationStage} did not remain visible after the render frame`);
  }
  let performanceSample: { warmupMs: number; sampleIntervalMs: number; windowRafFps: number; boardDataFps: number } | undefined;
  if (options.measure) {
    const warmupMs = 15_000;
    await page.waitForTimeout(warmupMs);
    if (!options.reducedMotion) {
      await page.waitForFunction(
        () => Number(document.querySelector(".fund-board-canvas")?.getAttribute("data-fps") ?? 0) > 0,
        undefined,
        { timeout: 30_000 },
      );
    }
    const before = await page.evaluate(() => ({ frames: (window as Window & { __visualFrameCount?: number }).__visualFrameCount ?? 0, now: performance.now() }));
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => ({ frames: (window as Window & { __visualFrameCount?: number }).__visualFrameCount ?? 0, now: performance.now(), boardDataFps: Number(document.querySelector(".fund-board-canvas")?.getAttribute("data-fps") ?? 0) }));
    performanceSample = { warmupMs, sampleIntervalMs: Math.round(after.now - before.now), windowRafFps: Math.round((after.frames - before.frames) * 1000 / (after.now - before.now)), boardDataFps: after.boardDataFps };
    if (!Number.isFinite(performanceSample.windowRafFps) || !Number.isFinite(performanceSample.boardDataFps)) throw new Error(`${name}: non-finite frame rate sample`);
  }
  const file = join(OUTPUT, `${name}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  const metrics = await page.evaluate(() => {
    const title = document.querySelector(".world-status h1");
    const sectors = document.querySelector(".world-sectors");
    const titleRect = title?.getBoundingClientRect();
    const sectorsRect = sectors?.getBoundingClientRect();
    return {
      width: innerWidth,
      docWidth: document.documentElement.scrollWidth,
      cells: document.querySelectorAll(".fund-board-accessible li").length,
      pawns: document.querySelectorAll(".fund-dock .pawn-object").length,
      presentationStage: document.querySelector(".game-world")?.getAttribute("data-presentation-stage") ?? null,
      centralBounds: (() => { const world = document.querySelector<HTMLElement>(".game-world"); if (!world) return null; const css = getComputedStyle(world); const top = Number.parseFloat(css.getPropertyValue("--center-top")) || 0; const right = Number.parseFloat(css.getPropertyValue("--center-right")) || 0; const bottom = Number.parseFloat(css.getPropertyValue("--center-bottom")) || 0; const left = Number.parseFloat(css.getPropertyValue("--center-left")) || 0; return { x: left, y: top, right: innerWidth - right, bottom: innerHeight - bottom }; })(),
      centralContentBounds: (() => { const el = document.querySelector<HTMLElement>(".floating-terminal,.central-decision .geography-scene,.cs-backdrop.is-embedded .cs-scene"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; })(),
      centralContentHudOverlap: (() => { const content = document.querySelector<HTMLElement>(".floating-terminal,.central-decision .geography-scene,.cs-backdrop.is-embedded .cs-scene"); if (!content) return false; const a = content.getBoundingClientRect(); return [".command-console", ".fund-dock"].some((selector) => { const el = document.querySelector<HTMLElement>(selector); if (!el || getComputedStyle(el).display === "none") return false; const b = el.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }); })(),
      terminalBounds: (() => { const el = document.querySelector(".floating-terminal"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; })(),
      dialogBounds: (() => { const el = document.querySelector(".geography-scene,.cs-scene,.victory-stage"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; })(),
      chartBounds: Array.from(document.querySelectorAll(".td-chart")).map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; }),
      fps: Number(document.querySelector(".fund-board-canvas")?.getAttribute("data-fps") ?? 0),
      phaseTitle: title && titleRect ? { text: title.textContent?.trim() ?? "", fontSize: getComputedStyle(title).fontSize, width: Math.round(titleRect.width), height: Math.round(titleRect.height), x: Math.round(titleRect.x), y: Math.round(titleRect.y) } : null,
      sectorsBounds: sectorsRect ? { x: Math.round(sectorsRect.x), y: Math.round(sectorsRect.y), width: Math.round(sectorsRect.width), height: Math.round(sectorsRect.height) } : null,
      phaseTitleOverlapsSectors: Boolean(titleRect && sectorsRect && titleRect.x < sectorsRect.right && titleRect.right > sectorsRect.left && titleRect.y < sectorsRect.bottom && titleRect.bottom > sectorsRect.top),
    };
  });
  if (metrics.docWidth > metrics.width) errors.push(`horizontal overflow ${metrics.docWidth}/${metrics.width}`);
  if (["trading", "portfolio", "analysis", "statistics", "geography", "context", "event", "bear", "prison"].includes(name) && !metrics.centralContentBounds) {
    errors.push("expected central terminal, decision, or card content is missing");
  }
  if (metrics.centralBounds && metrics.centralContentBounds) {
    const { centralBounds: area, centralContentBounds: content } = metrics;
    if (content.x < area.x - 1 || content.y < area.y - 1 || content.right > area.right + 1 || content.bottom > area.bottom + 1) errors.push("central content escapes the center area");
    if (metrics.centralContentHudOverlap) errors.push("central content overlaps the player HUD or fund dock");
  }
  if (roomId && roomId !== ROOM_IDS[0] && metrics.pawns !== 6) errors.push(`expected 6 visible fund pawns; found ${metrics.pawns}`);
  if (roomId && roomId !== ROOM_IDS[0] && metrics.cells !== 52) errors.push("missing game board");
  if (errors.length) throw new Error(`${name}: ${errors.join("; ")}; metrics=${JSON.stringify(metrics)}`);
  await context.close();
  return { name, file, ...metrics, ...(portfolioInteraction ? { portfolioInteraction } : {}), ...(focusTicketBounds ? { focusTicketBounds } : {}), ...(contextLaptopBounds ? { contextLaptopBounds } : {}), ...(performanceSample ? { performance: performanceSample } : {}) };
}

async function main() {
  if (!await import("node:fs/promises").then(({ access }) => access(resolve("apps/web/dist/index.html")).then(() => true).catch(() => false))) {
    throw new Error("apps/web/dist/index.html is missing. Run npm run build after frontend edits before capturing.");
  }
  await mkdir(OUTPUT, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "global-fund-visuals-"));
  const storageFile = join(temp, "rooms.json");
  await writeFile(storageFile, JSON.stringify(fixtures()), "utf8");
  delete process.env.DATABASE_URL;
  process.env.PUBLIC_ORIGIN = ORIGIN;
  const service = await createServer({ storageFile, logger: false });
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  try {
    await service.app.listen({ host: "127.0.0.1", port: PORT });
    await mkdir(OUTPUT, { recursive: true });
    const captures: Array<Awaited<ReturnType<typeof capture>>> = [];
    let reportInitialized = false;
    const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
    const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;
    const sizeArg = process.argv.find((arg) => arg.startsWith("--size="))?.slice("--size=".length);
    const selectedViewports = sizeArg ? VIEWPORTS.filter((viewport) => String(viewport.width) === sizeArg) : VIEWPORTS;
    if (!selectedViewports.length) throw new Error(`Unknown viewport width: ${sizeArg}`);
    const wants = (name: string) => !only || only.has(name);
    let mergeReport: () => Promise<void> = async () => {};
    const add = async (name: string, roomId?: string, viewport = VIEWPORTS[0]!, options: CaptureOptions = {}) => {
      const item = await capture(browser, name, roomId, viewport, options);
      captures.push(item);
      await mergeReport();
      if (item.width === 1920) {
        await mkdir(CURRENT, { recursive: true });
        for (const [alias, sourceName] of Object.entries(CURRENT_ALIASES)) {
          if (item.name === sourceName) await copyFile(item.file, resolve(CURRENT, `${alias}.png`));
        }
      }
      return item;
    };
    mergeReport = async () => {
      const reportFile = join(OUTPUT, "capture-report.json");
      let prior: typeof captures = [];
      if (reportInitialized || only || process.argv.includes("--perf-only")) {
        try { prior = JSON.parse(await readFile(reportFile, "utf8")) as typeof captures; } catch { /* first run */ }
      }
      for (const item of captures) {
        const index = prior.findIndex((old) => old.name === item.name && old.width === item.width);
        if (index === -1) prior.push(item); else prior[index] = item;
      }
      await writeFile(reportFile, JSON.stringify(prior, null, 2));
      reportInitialized = true;
    };
    if (process.argv.includes("--perf-only")) {
      await add("gameplay", ROOM_IDS[1]!, { width: 1920, height: 1080 }, { measure: true, boardView: true });
      await copyFile(captures[0]!.file, resolve("screenshots", "gameplay.png"));
      await mkdir(CURRENT, { recursive: true });
      await copyFile(captures[0]!.file, resolve(CURRENT, "board-1080p.png"));
      await add("gameplay-low-reduced", ROOM_IDS[1]!, { width: 1440, height: 900 }, { reducedMotion: true, quality: "low", measure: true, boardView: true });
      await mergeReport();
      console.log(JSON.stringify(captures, null, 2));
      return;
    }
    const full = (name: string, roomId?: string, options: CaptureOptions = {}, widths?: number[]) => async () => {
      const viewports = widths ? selectedViewports.filter((viewport) => widths.includes(viewport.width)) : selectedViewports;
      for (const viewport of viewports) {
        await add(name, roomId, viewport, { reducedMotion: true, ...options, ...(name === "gameplay" && viewport.width === 1920 ? { measure: true } : {}) });
      }
    };
    const views: Record<string, () => Promise<void>> = {
      "main-menu": full("main-menu"),
      lobby: full("lobby", ROOM_IDS[0]!),
      "setup-markets": full("setup-markets", undefined, { setupMarkets: true }, [1920, 1366]),
      gameplay: full("gameplay", ROOM_IDS[1]!, { boardView: true }),
      trading: full("trading", ROOM_IDS[2]!),
      portfolio: full("portfolio", ROOM_IDS[1]!, { panel: "portfolio" }),
      analysis: full("analysis", ROOM_IDS[1]!, { panel: "analysis" }),
      statistics: full("statistics", ROOM_IDS[1]!, { panel: "statistics" }),
      geography: full("geography", ROOM_IDS[7]!),
      context: full("context", ROOM_IDS[3]!, { expectedCardTitle: "Une nouvelle frontière énergétique" }),
      event: full("event", ROOM_IDS[4]!, { expectedCardTitle: "Dividende exceptionnel" }),
      bear: full("bear", ROOM_IDS[5]!, { expectedCardTitle: "Market Bear" }),
      prison: full("prison", ROOM_IDS[6]!, { expectedCardTitle: "Enquête judiciaire" }),
      ending: full("ending", ROOM_IDS[8]!),
      ...Object.fromEntries(MARKET_IDS.map((market, index) => [`office-${market}`, full(`office-${market}`, ROOM_IDS[index + 12]!, { boardView: true }, [1920, 1366])])),
    };
    for (const name of Object.keys(views)) if (wants(name)) await views[name]!();

    // Persist the static capture metrics before transient phase captures so an
    // interrupted phase run still leaves a truthful report and current aliases.
    for (const name of ["main-menu", "lobby", "gameplay", "trading", "portfolio", "analysis", "statistics", "geography", "context", "event", "bear", "prison", "ending"]) {
      if (!wants(name)) continue;
      const source = captures.find((item) => item.name === name && item.width === 1920)?.file;
      if (source) await copyFile(source, resolve("screenshots", `${name}.png`));
    }
    const contextCapture = wants("context") ? captures.find((item) => item.name === "context")?.file : undefined;
    if (contextCapture) await copyFile(contextCapture, resolve("screenshots", "context-event.png"));
    await mkdir(CURRENT, { recursive: true });
    for (const [alias, sourceName] of Object.entries(CURRENT_ALIASES)) {
      const source = captures.find((item) => item.name === sourceName && item.width === 1920)?.file;
      if (source) await copyFile(source, resolve(CURRENT, `${alias}.png`));
    }
    if (wants("presentation-stages")) {
      await add("dice-rolling", ROOM_IDS[9]!, VIEWPORTS[0], { presentationStage: "DICE_ROLLING" });
      await add("dice-result", ROOM_IDS[10]!, VIEWPORTS[0], { presentationStage: "DICE_RESULT" });
      await add("pawn-moving", ROOM_IDS[11]!, VIEWPORTS[0], { presentationStage: "PAWN_MOVING" });
    }
    if (wants("presentation-stages") || wants("market-impact")) await add("market-impact", ROOM_IDS[3]!, selectedViewports[0]!, { expectedCardTitle: "Une nouvelle frontière énergétique", presentationStage: "MARKET_IMPACT", advanceCard: true });
    if (wants("gameplay-low-reduced")) await add("gameplay-low-reduced", ROOM_IDS[1]!, VIEWPORTS[1], { reducedMotion: true, quality: "low", measure: true, boardView: true });
    const diceResultCapture = wants("presentation-stages") ? captures.find((item) => item.name === "dice-result")?.file : undefined;
    if (diceResultCapture) await copyFile(diceResultCapture, resolve("screenshots", "dice-result.png"));
    for (const [alias, sourceName] of Object.entries(CURRENT_ALIASES)) {
      const source = captures.find((item) => item.name === sourceName && item.width === 1920)?.file;
      if (source) await copyFile(source, resolve(CURRENT, `${alias}.png`));
    }
    await mergeReport();
    console.log(JSON.stringify(captures, null, 2));
  } finally {
    await browser.close();
    await service.close();
    await rm(temp, { recursive: true, force: true });
    await delay(50);
  }
}

await main();
