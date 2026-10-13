/**
 * Redesign visual harness — captures every game scene from the live Vite sources.
 *
 * It starts an isolated game server (fixture rooms, no database, no saved rooms)
 * and a private Vite dev server proxied to it, then drives Chromium through each
 * scene and saves screenshots. Nothing is written outside --out and the OS temp dir.
 *
 *   npx tsx scripts/redesign/shoot.ts --scenes=board,trading --sizes=1920x1080,1366x768 --out=<dir>
 *
 * Options
 *   --scenes=a,b      Scene names (default: all). See SCENES below.
 *   --sizes=WxH,...   Viewports (default 1920x1080,1366x768).
 *   --out=<dir>       Output directory (default: <os tmp>/gf-shots).
 *   --motion=reduce   "reduce" (default, deterministic) or "full" (animations on).
 *   --hold=1500       Extra settle time in ms before each screenshot.
 *   --cache=<name>    Private Vite dependency cache name (use one per agent).
 *   --swiftshader     Force software WebGL (what CI/E2E use). Default: hardware GPU.
 *   --serve           Keep both servers running and print sessions for manual use.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createGame, executeCommand, getGameView, priceFor } from "@global-fund/game-engine";
import type { GameState, RoomPlayer, SeatConfig, Session } from "@global-fund/shared";
import { PLAYER_COLORS } from "@global-fund/shared";
import { createServer as createViteServer } from "vite";
import { createServer } from "../../apps/server/src/server.js";
import { installIncomeFixtureRoute } from "../../tests/fixtures/install-income-route.js";
import { installSettlementFixtureRoute } from "../../tests/fixtures/install-settlement-route.js";
import { installContextFixtureRoute } from "../../tests/fixtures/install-context-route.js";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key!, rest.length ? rest.join("=") : "true"] as const;
}));
const ROOT = resolve(import.meta.dirname, "../..");
const TOKEN = "redesign-visual-session";
const MOTION = args.get("motion") === "full" ? "full" : "reduce";
const HOLD = Number(args.get("hold") ?? 1500);
const OUT = resolve(args.get("out") ?? join(tmpdir(), "gf-shots"));
const SIZES = (args.get("sizes") ?? "1920x1080,1366x768").split(",").map((size) => {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) throw new Error(`Invalid size: ${size}`);
  return { width, height };
});

// ---------------------------------------------------------------- fixtures --
const seatRows: Array<[string, SeatConfig["startingMarket"], SeatConfig["pawn"]]> = [
  ["Amara Diallo", "africa", "lion"], ["Luca Moretti", "europe", "bull"],
  ["Mei Chen", "asia", "globe"], ["Sofia Costa", "americas", "crystal"],
  ["Noah Williams", "oceania", "tower"], ["Aiko Sato", "africa", "leaf"],
];
const seats: SeatConfig[] = seatRows.map(([name, startingMarket, pawn]) => ({ name, startingMarket, pawn, kind: "local", difficulty: "normal" }));
const seeded = <T,>(fn: () => T): T => {
  const original = Math.random;
  let seed = 0x51f15e;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  try { return fn(); } finally { Math.random = original; }
};
const withSix = <T,>(fn: () => T): T => {
  const original = Math.random;
  Math.random = () => 0.999999;
  try { return fn(); } finally { Math.random = original; }
};

function baseState(): GameState {
  const state = seeded(() => createGame(seats));
  state.activeIndex = 0; state.starterIndex = 0; state.initiative = seats.map((_, i) => 6 - i);
  state.cycle = 7; state.phase = "market"; state.stage = "market"; state.completedPlayers = [];
  state.players.forEach((player, i) => {
    player.zone = seats[i]!.startingMarket; player.currentMarket = seats[i]!.startingMarket;
    player.sectorPosition = i * 7; player.geoResolved = true;
    player.cash = [185, 74, 121, 93, 216, 138][i]!;
  });
  state.zoneGrades = { americas: "B", europe: "A", asia: "C", africa: "D", oceania: "C" };
  state.sectorGrades = { technology: "A", finance: "B", industry: "C", health: "C", energy: "D", realestate: "B", agrifood: "C", media: "D", transport: "B" };
  for (const company of state.companies.filter((c) => c.zone === "europe" && c.sector === "technology" && c.available)) {
    company.holdings = { p1: 5 }; company.costBasis = { p1: 5 * priceFor(company, state) };
  }
  for (const [index, company] of state.companies.filter((c) => c.available).slice(4, 30).entries()) {
    const pid = `p${index % seats.length + 1}`;
    const amount = index % 8 === 0 ? 5 : index % 3 + 1;
    if (Object.values(company.holdings).reduce((s, n) => s + n, 0) + amount > 5) continue;
    company.holdings[pid] = amount; company.costBasis![pid] = amount * priceFor(company, state);
  }
  state.players = getGameView(state).players as typeof state.players;
  const history = structuredClone(state);
  history.cycle = 0; history.marketHistory = [];
  for (let index = 0; index < 7; index++) {
    const active = history.players[history.activeIndex]!;
    history.phase = "awaitNext";
    history.completedPlayers = history.players.filter((p) => p.id !== active.id).map((p) => p.id);
    Object.assign(history, executeCommand(history, active.id, { type: "NEXT_TURN" }));
  }
  state.marketHistory = history.marketHistory;
  return state;
}
function eventState(effect: "prison" | "dividend", title: string): GameState {
  const state = baseState();
  state.phase = "sector"; state.stage = "sector";
  const company = state.companies.find((c) => c.zone === "europe" && c.sector === "technology" && c.available && (c.holdings.p1 ?? 0) > 0)!;
  const target = state.board.findIndex((cell, index) => index >= 6 && cell.kind === "event");
  state.players[0]!.sectorPosition = (target - 6 + state.board.length) % state.board.length;
  state.boardEventDeck = [{ id: `visual-${effect}`, title, story: effect === "dividend" ? "Le conseil d’administration vote une distribution exceptionnelle pour {company}." : "Une décision judiciaire ouvre une enquête sur {company}.", effect, amount: 3, targetSector: company.sector }];
  return withSix(() => executeCommand(state, "p1", { type: "ROLL" }));
}
function contextState(): GameState {
  const state = baseState();
  state.phase = "awaitNext"; state.stage = "awaitNext";
  state.completedPlayers = state.players.filter((p) => p.id !== "p1").map((p) => p.id);
  state.deck.unshift({ id: "visual-context", title: "Une nouvelle frontière énergétique", type: "neutral", description: "Les investisseurs réévaluent leur exposition aux marchés de l’énergie.", changes: [{ scope: "sector", id: "energy", grade: "B" }, { scope: "zone", id: "asia", grade: "D" }] });
  return executeCommand(state, "p1", { type: "NEXT_TURN" });
}
function marketCellState(pattern: RegExp): GameState {
  const state = baseState();
  state.phase = "sector"; state.stage = "sector";
  const target = state.board.findIndex((cell) => cell.kind === "market" && pattern.test(cell.label));
  state.players[0]!.sectorPosition = (target - 6 + state.board.length) % state.board.length;
  return withSix(() => executeCommand(state, "p1", { type: "ROLL" }));
}
function phaseState(phase: "geography" | "sector" | "finished"): GameState {
  const state = baseState();
  state.phase = phase; state.stage = phase; state.notices = []; state.completedPlayers = [];
  if (phase === "geography") { state.cycle = 2; state.players[0]!.geoResolved = false; }
  if (phase === "finished") {
    state.finished = true;
    const top = Math.max(...state.players.map((p) => p.fundValue));
    state.winnerIds = state.players.filter((p) => p.fundValue === top).map((p) => p.id);
  }
  return state;
}
function jailedState(): GameState {
  const state = phaseState("geography");
  const player = state.players[0]!;
  player.previousZone = player.zone ?? undefined; player.jailed = true; player.zone = "prison"; player.currentMarket = null; player.prisonStage = 1;
  return state;
}

type StoredPlayer = RoomPlayer & { tokenHash: string | null };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function room(roomId: string, state: GameState | null, status: "lobby" | "playing" = "playing", kinds: RoomPlayer["kind"][] = []) {
  const players: StoredPlayer[] = seats.map((seat, i) => ({
    id: `p${i + 1}`, name: seat.name, kind: kinds[i] ?? "local", bot: kinds[i] === "ai", pawn: seat.pawn,
    startingMarket: state?.players[i]?.startingMarket ?? seat.startingMarket, difficulty: seat.difficulty,
    color: PLAYER_COLORS[i]!, ready: i % 2 === 0, connected: i < 3, controllerId: null, tokenHash: i === 0 ? hash(TOKEN) : null,
  }));
  return { roomId, status, hostId: "", hostPlayerId: "p1", players, state, messages: status === "lobby" ? [
    { id: "m1", playerId: "p2", name: "Luca Moretti", text: "Prêt quand vous l’êtes.", createdAt: new Date().toISOString() },
  ] : [], revision: 1, commandIds: {}, chatTimes: {} };
}

// Room ids must match the server format /^[A-F0-9]{8}$/.
const ROOMS: Record<string, () => ReturnType<typeof room>> = {
  D0000001: () => room("D0000001", null, "lobby", ["local", "remote", "ai", "ai", "remote", "ai"]),
  D0000002: () => room("D0000002", baseState()),
  D0000003: () => room("D0000003", contextState()),
  D0000004: () => room("D0000004", eventState("dividend", "Dividende exceptionnel")),
  D0000005: () => room("D0000005", eventState("prison", "Enquête judiciaire")),
  D0000006: () => room("D0000006", marketCellState(/crash/i)),
  D0000007: () => room("D0000007", marketCellState(/bull/i)),
  D0000008: () => room("D0000008", marketCellState(/bear/i)),
  D0000009: () => room("D0000009", phaseState("geography")),
  D000000A: () => room("D000000A", jailedState()),
  D000000B: () => room("D000000B", phaseState("sector")),
  D000000C: () => room("D000000C", phaseState("finished")),
  // One fresh travel decision per viewport for the travel-flight scene (the flight mutates its room).
  D000000D: () => room("D000000D", phaseState("geography")),
  D000000E: () => room("D000000E", phaseState("geography")),
  D000000F: () => room("D000000F", phaseState("geography")),
};

// ------------------------------------------------------------------ scenes --
type Ctx = { page: Page; context: BrowserContext; browser: Browser; gameOrigin: string; webOrigin: string; size: { width: number; height: number } };
type Scene = { room?: string | ((sizeIndex: number) => string); run: (ctx: Ctx, shot: (suffix?: string) => Promise<void>) => Promise<void> };

const continueLabel = "Continuer et appliquer les conséquences";
async function waitBoard(page: Page) {
  await page.locator(".game-world").waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector(".fund-board-canvas")?.getAttribute("data-scene-ready") === "true", undefined, { timeout: 45_000 })
    .catch(() => console.warn("  ! board scene never reported data-scene-ready=true"));
}
async function waitCard(page: Page) { await page.locator(".cs-scene").first().waitFor({ state: "visible", timeout: 45_000 }); }
async function closeTerminal(page: Page) {
  const close = page.getByRole("button", { name: "Retour au plateau" });
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.waitForTimeout(600);
}
async function continueUntil(page: Page, done: () => Promise<boolean>) {
  for (let step = 0; step < 16; step++) {
    if (await done()) return;
    const card = page.locator(".cs-scene");
    const impact = page.locator(".impact-continue");
    if (await card.isVisible().catch(() => false)) await card.getByRole("button", { name: continueLabel }).click().catch(() => {});
    else if (await impact.isVisible().catch(() => false)) await impact.click().catch(() => {});
    await page.waitForTimeout(350);
  }
}
async function attachSession(ctx: Ctx, session: Session) {
  await ctx.context.addInitScript((value) => localStorage.setItem("global-fund-evolve:session", JSON.stringify(value)), session);
  await ctx.page.goto(ctx.webOrigin, { waitUntil: "domcontentloaded" });
}
async function postFixture(ctx: Ctx, path: string, body: unknown = {}) {
  const response = await fetch(`${ctx.gameOrigin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
}

const SCENES: Record<string, Scene> = {
  menu: { run: async ({ page }, shot) => { await page.getByRole("button", { name: /NOUVELLE PARTIE/ }).waitFor(); await shot(); } },
  settings: { run: async ({ page }, shot) => { await page.getByRole("button", { name: /PARAMÈTRES/i }).first().click(); await shot(); } },
  rules: { run: async ({ page }, shot) => { await page.getByRole("button", { name: /RÈGLES/i }).first().click(); await shot(); } },
  setup: { run: async ({ page }, shot) => { await page.getByRole("button", { name: /NOUVELLE PARTIE/ }).click(); await page.getByTestId("setup-step-funds").waitFor(); await shot(); } },
  "setup-markets": { run: async ({ page }, shot) => {
    await page.getByRole("button", { name: /NOUVELLE PARTIE/ }).click();
    await page.getByRole("button", { name: /Choisir les places/ }).click();
    await page.getByTestId("setup-step-markets").waitFor(); await shot();
  } },
  join: { run: async ({ page }, shot) => { await page.getByRole("button", { name: /REJOINDRE/ }).click(); await shot(); } },
  lobby: { room: "D0000001", run: async ({ page }, shot) => { await page.getByText("CODE D’INVITATION").waitFor({ timeout: 30_000 }); await shot(); } },
  board: { room: "D0000002", run: async ({ page }, shot) => { await waitBoard(page); await closeTerminal(page); await shot(); } },
  loading: { room: "D0000002", run: async ({ page, size }, shot) => {
    const start = Date.now();
    for (const at of [300, 1200, 2400]) {
      const wait = at - (Date.now() - start);
      if (wait > 0) await page.waitForTimeout(wait);
      await shot(`t${String(at).padStart(4, "0")}`);
    }
    await waitBoard(page);
    console.log(`  loading ${size.width}x${size.height}: scene ready ${Date.now() - start} ms after the page answered`);
    await page.waitForTimeout(120); await shot("ready");
    await page.waitForTimeout(900); await shot("revealed");
  } },
  hover: { room: "D0000002", run: async ({ page }, shot) => {
    await waitBoard(page); await closeTerminal(page);
    await page.locator(".fund-dock .investor-card").nth(1).hover(); await page.waitForTimeout(800); await shot("a-player");
    await page.locator(".world-sectors .economic-tile").first().hover(); await page.waitForTimeout(800); await shot("b-sector");
    await page.locator(".world-zones .economic-zone").nth(1).hover(); await page.waitForTimeout(800); await shot("c-zone");
  } },
  chat: { room: "D0000002", run: async ({ page }, shot) => {
    await waitBoard(page); await closeTerminal(page);
    await page.locator(".world-tools").getByRole("button", { name: /Salon/ }).click(); await shot();
  } },
  dice: { room: "D000000B", run: async ({ page }, shot) => { await waitBoard(page); await shot(); } },
  roll: { room: "D000000B", run: async ({ page }, shot) => {
    await waitBoard(page);
    await page.locator(".turn-actions").getByRole("button", { name: "Lancer le dé" }).click();
    for (const [delay, label] of [[450, "a-rolling"], [900, "b-result"], [900, "c-moving"], [1600, "d-arrival"]] as const) {
      await page.waitForTimeout(delay); await shot(label);
    }
  } },
  trading: { room: "D0000002", run: async ({ page }, shot) => { await waitBoard(page); await page.locator(".floating-terminal").waitFor({ timeout: 20_000 }); await shot(); } },
  portfolio: { room: "D0000002", run: async ({ page }, shot) => {
    await waitBoard(page); await page.locator(".floating-terminal").waitFor({ timeout: 20_000 });
    await page.locator(".td-tabs button").filter({ hasText: "Portefeuille" }).click(); await shot();
  } },
  analysis: { room: "D0000002", run: async ({ page }, shot) => {
    await waitBoard(page); await page.locator(".floating-terminal").waitFor({ timeout: 20_000 });
    await page.locator(".td-tabs button").filter({ hasText: "Analyse" }).click(); await shot();
  } },
  statistics: { room: "D0000002", run: async ({ page }, shot) => {
    await waitBoard(page); await page.locator(".floating-terminal").waitFor({ timeout: 20_000 });
    await page.locator(".td-tabs button").filter({ hasText: "Statistiques" }).click(); await shot();
  } },
  travel: { room: "D0000009", run: async ({ page }, shot) => {
    await waitBoard(page); await page.locator(".geography-scene").waitFor({ timeout: 20_000 }); await shot();
    const other = page.locator(".travel-market:not(.current-market)").first().getByRole("radio");
    if (await other.isVisible().catch(() => false)) { await other.click(); await page.waitForTimeout(900); await shot("selected"); }
  } },
  "travel-flight": { room: (sizeIndex) => ["D000000D", "D000000E", "D000000F"][sizeIndex % 3]!, run: async ({ page }, shot) => {
    await waitBoard(page); await page.locator(".geography-scene").waitFor({ timeout: 20_000 });
    await page.locator(".travel-market:not(.current-market)").first().getByRole("radio").click();
    await page.waitForTimeout(700);
    const start = Date.now();
    await page.locator(".travel-go").click();
    // Frames across the whole cinematic (PRESENTATION_TIMING.travel = 6500 ms) and just after it.
    for (const at of [250, 700, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6600, 7400]) {
      const wait = at - (Date.now() - start);
      if (wait > 0) await page.waitForTimeout(wait);
      await shot(`t${String(at).padStart(4, "0")}`);
    }
  } },
  jail: { room: "D000000A", run: async ({ page }, shot) => { await waitBoard(page); await page.waitForTimeout(500); await shot(); } },
  context: { room: "D0000003", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  impact: { room: "D0000003", run: async ({ page }, shot) => {
    await waitBoard(page); await waitCard(page); await page.keyboard.press("Escape");
    await page.locator(".consequence-ribbon").waitFor({ timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(400); await shot();
  } },
  event: { room: "D0000004", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  prison: { room: "D0000005", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  crash: { room: "D0000006", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  bull: { room: "D0000007", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  bear: { room: "D0000008", run: async ({ page }, shot) => { await waitBoard(page); await waitCard(page); await shot(); } },
  payments: { run: async (ctx, shot) => {
    const { session } = await postFixture(ctx, "/__test/income-fixture") as { session: Session };
    await attachSession(ctx, session); await waitBoard(ctx.page); await ctx.page.locator(".cs-scene.is-payments").waitFor({ timeout: 30_000 }); await shot();
  } },
  "settlement-cash": { run: async (ctx, shot) => {
    const { sessions } = await postFixture(ctx, "/__test/settlement-fixture", { playerCount: 3, cashOnly: true }) as { sessions: Session[] };
    await attachSession(ctx, sessions[0]!); await waitBoard(ctx.page); await ctx.page.locator(".cs-scene.is-payments").waitFor({ timeout: 30_000 }); await shot();
  } },
  settlement: { run: async (ctx, shot) => {
    const { sessions } = await postFixture(ctx, "/__test/settlement-fixture", { playerCount: 3 }) as { sessions: Session[] };
    await attachSession(ctx, sessions[0]!); await waitBoard(ctx.page);
    const desk = ctx.page.getByRole("main", { name: "Desk de règlement" });
    await continueUntil(ctx.page, () => desk.isVisible().catch(() => false));
    await desk.waitFor({ timeout: 20_000 });
    await ctx.page.locator(".sd-assets-table tbody tr").first().getByRole("button", { name: /^Ajouter une part/ }).click().catch(() => {});
    await shot();
  } },
  creditor: { run: async (ctx, shot) => {
    const { sessions } = await postFixture(ctx, "/__test/settlement-fixture", { creditorCash: 100, assetValue: 27 }) as { sessions: Session[] };
    await attachSession(ctx, sessions[0]!); await waitBoard(ctx.page);
    const desk = ctx.page.getByRole("main", { name: "Desk de règlement" });
    await continueUntil(ctx.page, () => desk.isVisible().catch(() => false));
    await ctx.page.locator(".sd-assets-table tbody tr").first().getByRole("button", { name: /^Ajouter une part/ }).click();
    await ctx.page.getByRole("button", { name: /Proposer au créancier/ }).click();
    const creditorContext = await ctx.browser.newContext({ viewport: ctx.size, deviceScaleFactor: 1, reducedMotion: MOTION === "full" ? "no-preference" : "reduce" });
    try {
      await creditorContext.addInitScript((value) => localStorage.setItem("global-fund-evolve:session", JSON.stringify(value)), sessions[1]!);
      const page = await creditorContext.newPage();
      await page.goto(ctx.webOrigin, { waitUntil: "domcontentloaded" });
      await waitBoard(page);
      const offer = page.locator(".sd-offer-main");
      await continueUntil(page, () => offer.isVisible().catch(() => false));
      await offer.waitFor({ timeout: 20_000 });
      await page.waitForTimeout(HOLD);
      await page.screenshot({ path: join(OUT, `creditor-${ctx.size.width}x${ctx.size.height}.png`), animations: "disabled" });
    } finally { await creditorContext.close(); }
    void shot;
  } },
  ending: { room: "D000000C", run: async ({ page }, shot) => { await page.locator(".victory-stage").waitFor({ timeout: 45_000 }); await shot(); } },
};

// ------------------------------------------------------------------ runner --
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port")));
    });
  });
}

async function main() {
  const selected = (args.get("scenes") ?? Object.keys(SCENES).join(",")).split(",").filter(Boolean);
  for (const name of selected) if (!SCENES[name]) throw new Error(`Unknown scene "${name}". Known: ${Object.keys(SCENES).join(", ")}`);
  await mkdir(OUT, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "gf-redesign-"));
  const storageFile = join(temp, "rooms.json");
  await writeFile(storageFile, JSON.stringify(Object.values(ROOMS).map((build) => build())), "utf8");

  const gamePort = await freePort();
  const webPort = await freePort();
  const gameOrigin = `http://127.0.0.1:${gamePort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  delete process.env.DATABASE_URL;
  process.env.PUBLIC_ORIGIN = webOrigin;
  const service = await createServer({ storageFile, logger: false });
  installSettlementFixtureRoute(service);
  installIncomeFixtureRoute(service);
  installContextFixtureRoute(service);
  await service.app.listen({ host: "127.0.0.1", port: gamePort });

  const vite = await createViteServer({
    root: join(ROOT, "apps/web"),
    configFile: join(ROOT, "apps/web/vite.config.ts"),
    cacheDir: join(tmpdir(), `gf-vite-cache-${(args.get("cache") ?? "default").replace(/[^\w-]/g, "")}`),
    logLevel: "error",
    clearScreen: false,
    server: { host: "127.0.0.1", port: webPort, strictPort: true, hmr: false, proxy: { "/socket.io": { target: gameOrigin, ws: true } } },
  });
  await vite.listen();
  console.log(`game ${gameOrigin} · web ${webOrigin} · motion ${MOTION} · out ${OUT}`);

  if (args.has("serve")) {
    console.log(`Session token for fixture rooms: ${TOKEN} (playerId p1). Rooms: ${Object.keys(ROOMS).join(", ")}`);
    console.log(`Open ${webOrigin} — press Ctrl+C to stop.`);
    return;
  }

  const browser = await chromium.launch({ headless: true, args: args.has("swiftshader") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  const report: { scene: string; size: string; files: string[]; errors: string[] }[] = [];
  try {
    // Warm Vite's dependency optimizer once so the first scene is not a cold compile.
    { const warm = await browser.newPage(); await warm.goto(webOrigin, { waitUntil: "load", timeout: 120_000 }).catch(() => {}); await warm.waitForTimeout(4000); await warm.close(); }
    for (const name of selected) {
      for (const [sizeIndex, size] of SIZES.entries()) {
        const scene = SCENES[name]!;
        const roomId = typeof scene.room === "function" ? scene.room(sizeIndex) : scene.room;
        const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: MOTION === "full" ? "no-preference" : "reduce" });
        if (roomId) await context.addInitScript(({ roomId, token }) => localStorage.setItem("global-fund-evolve:session", JSON.stringify({ roomId, playerId: "p1", token })), { roomId, token: TOKEN });
        await context.addInitScript((reduced) => localStorage.setItem("global-fund-presentation-settings", JSON.stringify({ quality: "high", reducedMotion: reduced })), MOTION !== "full");
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
        page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
        const files: string[] = [];
        const shot = async (suffix?: string) => {
          await page.waitForTimeout(suffix ? 0 : HOLD);
          const file = join(OUT, `${name}${suffix ? `-${suffix}` : ""}-${size.width}x${size.height}.png`);
          await page.screenshot({ path: file, animations: MOTION === "full" ? "allow" : "disabled" });
          files.push(file);
        };
        try {
          if (roomId || !["payments", "settlement-cash", "settlement", "creditor"].includes(name)) await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
          await page.getByText("Serveur connecté").first().waitFor({ timeout: 30_000 }).catch(() => {});
          await scene.run({ page, context, browser, gameOrigin, webOrigin, size }, shot);
        } catch (error) {
          errors.push(`scene failed: ${(error as Error).message.split("\n")[0]}`);
          const file = join(OUT, `${name}-FAILED-${size.width}x${size.height}.png`);
          await page.screenshot({ path: file }).catch(() => {});
          files.push(file);
        }
        report.push({ scene: name, size: `${size.width}x${size.height}`, files, errors });
        console.log(`${errors.length ? "✗" : "✓"} ${name} ${size.width}x${size.height}${errors.length ? `\n    ${errors.slice(0, 6).join("\n    ")}` : ""}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await vite.close();
    await service.close();
  }
  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Report: ${join(OUT, "report.json")}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
