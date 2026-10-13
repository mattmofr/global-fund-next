import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  chooseAiCommand,
  createGame,
  executeCommand,
  fundValue,
  getDecisionPlayerId,
  priceFor,
} from "@global-fund/game-engine";
import type { Company, GameState, SeatConfig, ZoneId } from "@global-fund/shared";

const DEFAULT_SEED = 20261013;
const DEFAULT_TIME_CAP_SECONDS = 600;
const HISTORY_RETENTION = 2;
const CHECKPOINT_CYCLES = [10, 35, 70] as const;
const DIFFICULTIES = ["easy", "normal", "hard"] as const;
const PAWNS = ["lion", "bull", "globe"] as const;
const CATEGORIES = ["small", "medium", "large", "unknown"] as const;
type Category = (typeof CATEGORIES)[number];
type PurchaseMoment = { cycle: number; individualTurn: number; companyId: string };
type FirstPurchases = { any: PurchaseMoment | null } & Record<"small" | "medium" | "large", PurchaseMoment | null>;

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
function numericOption(name: string, fallback: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric.`);
  return value;
}
function randomFor(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}
function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const lowValue = ordered[lower] ?? 0;
  return lowValue + ((ordered[lower + 1] ?? lowValue) - lowValue) * (position - lower);
}
function hashSeed(seed: number): string {
  return createHash("sha256").update(String(seed)).digest("hex");
}
function categoryOf(company: Company): Category {
  const tagged = (company as Company & { capCategory?: Category }).capCategory;
  if (tagged && CATEGORIES.includes(tagged)) return tagged;
  const marketCap = Number((company as Company & { marketCapUSD?: number }).marketCapUSD);
  if (!Number.isFinite(marketCap) || marketCap <= 0) return "unknown";
  if (marketCap < 40_000_000_000) return "small";
  if (marketCap < 200_000_000_000) return "medium";
  return "large";
}
function shareCount(company: Company): number {
  return Object.values(company.holdings ?? {}).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
}
function reserveFor(difficulty: string | undefined): number {
  return difficulty === "hard" ? 18 : difficulty === "easy" ? 45 : 30;
}

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index]?.startsWith("--") && !["--games", "--seed", "--seconds", "--label", "--catalog", "--output"].includes(args[index]!)) {
    throw new Error(`Unknown option: ${args[index]}`);
  }
}
const requestedGames = numericOption("--games", 5);
const baseSeed = numericOption("--seed", DEFAULT_SEED);
const timeCapSeconds = numericOption("--seconds", DEFAULT_TIME_CAP_SECONDS);
const outputLabel = option("--label", "baseline-5");
const baselineCatalogPath = option("--catalog", "");
const outputPath = option("--output", `docs/economic-progression-${outputLabel}.json`);
if (!Number.isInteger(requestedGames) || requestedGames < 1 || requestedGames > 10000) throw new Error("--games must be an integer from 1 through 10000.");
if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) throw new Error("--seed must be a nonnegative safe integer.");
if (!(timeCapSeconds > 0)) throw new Error("--seconds must be positive.");
if (!/^[a-z0-9-]+$/.test(outputLabel)) throw new Error("--label must use lowercase letters, digits, and hyphens.");
if (baselineCatalogPath && !existsSync(baselineCatalogPath)) throw new Error(`Catalog not found: ${baselineCatalogPath}`);

const dataPath = "packages/game-engine/legacy/data/gameData.json";
const gameCorePath = "packages/game-engine/legacy/game.cjs";
const marketRulesPath = "packages/game-engine/legacy/marketRules.cjs";
const engineFacadePath = "packages/game-engine/src/index.ts";
const sourceHashes = {
  gameData: sha256(dataPath),
  gameCore: sha256(gameCorePath),
  marketRules: sha256(marketRulesPath),
  engineFacade: sha256(engineFacadePath),
  simulator: sha256("scripts/simulate-economic-progression.ts"),
  baselineCatalog: baselineCatalogPath ? sha256(baselineCatalogPath) : null,
};
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const baselineCompanies: Company[] = baselineCatalogPath
  ? (() => {
      const parsed = JSON.parse(readFileSync(baselineCatalogPath, "utf8"));
      const companies = Array.isArray(parsed) ? parsed : parsed.companies;
      if (!Array.isArray(companies) || companies.length !== 91) throw new Error("Baseline catalog must contain exactly 91 companies.");
      if (new Set(companies.map((company: Company) => company.id)).size !== 91) throw new Error("Baseline catalog company IDs must be unique.");
      return companies;
    })()
  : [];
const baselineById = new Map(baselineCompanies.map((company) => [company.id, company]));
const currentCatalogCompanies = (JSON.parse(readFileSync(dataPath, "utf8")) as { companies: Company[] }).companies;
const catalogIds = currentCatalogCompanies.map((company) => company.id);
if (catalogIds.length !== 91 || new Set(catalogIds).size !== 91) throw new Error("Current game catalog must preserve exactly 91 unique legacy company IDs.");
if (baselineById.size && (baselineById.size !== catalogIds.length || catalogIds.some((id) => !baselineById.has(id)))) {
  throw new Error("Baseline and active catalog must contain the same 91 legacy company IDs.");
}

function applyEconomicCatalog(state: GameState) {
  if (!baselineById.size) return;
  state.companies = state.companies.map((company) => {
    const baseline = baselineById.get(company.id)!;
    return {
      ...company,
      ...baseline,
      // The override is static catalog data. Keep only the live holdings and
      // settlement availability from the just-created game state.
      holdings: company.holdings,
      costBasis: company.costBasis,
      available: company.available,
      price: baseline.basePrice,
      income: baseline.baseIncome,
      totalHeld: shareCount(company),
      sharesAvailable: Math.max(0, 5 - shareCount(company)),
      averageBuyPrice: company.averageBuyPrice,
    };
  });
  // createGame records opening values before a baseline override; replace that one reporting point.
  for (const point of state.marketHistory ?? []) {
    point.prices = Object.fromEntries(state.companies.map((company) => [company.id, priceFor(company, state)]));
    point.funds = Object.fromEntries(state.players.map((player) => [player.id, fundValue(state, player)]));
  }
}

function snapshot(state: GameState) {
  const smallCompaniesByPlayer: Record<string, number> = {};
  const smallSharesByPlayer: Record<string, number> = {};
  for (const player of state.players) {
    const small = state.companies.filter((company) => categoryOf(company) === "small");
    smallCompaniesByPlayer[player.id] = small.filter((company) => Number(company.holdings?.[player.id] ?? 0) > 0).length;
    smallSharesByPlayer[player.id] = small.reduce((sum, company) => sum + Number(company.holdings?.[player.id] ?? 0), 0);
  }
  const playerRows = state.players.map((player) => ({
    id: player.id,
    difficulty: player.difficulty ?? "unknown",
    startingMarket: player.startingMarket,
    solvent: player.solvent,
    cash: player.cash,
    nav: fundValue(state, player),
    smallCompanies: smallCompaniesByPlayer[player.id] ?? 0,
    smallShares: smallSharesByPlayer[player.id] ?? 0,
  }));
  const summarize = (rows: typeof playerRows) => ({
    funds: rows.length,
    averageCash: average(rows.map((row) => row.cash)),
    medianCash: median(rows.map((row) => row.cash)),
    averageNAV: average(rows.map((row) => row.nav)),
    medianNAV: median(rows.map((row) => row.nav)),
    averageSmallCompaniesPerFund: average(rows.map((row) => row.smallCompanies)),
    averageSmallSharesPerFund: average(rows.map((row) => row.smallShares)),
  });
  return {
    cycle: state.cycle,
    allFunds: summarize(playerRows),
    solventFunds: summarize(playerRows.filter((row) => row.solvent)),
    players: playerRows,
  };
}

function rotateMarkets(zones: string[], gameIndex: number): string[] {
  // Each difficulty sees all five markets once per five-game block.
  const offset = gameIndex % 5;
  return DIFFICULTIES.map((_, difficultyIndex) => zones[(offset + difficultyIndex * 2) % zones.length]!);
}

const campaignStarted = performance.now();
const originalRandom = Math.random;
const completedRecords: Record<string, unknown>[] = [];
const partialGames: Record<string, unknown>[] = [];
const failures: Record<string, unknown>[] = [];
let commands = 0;
let globalTimeExpired = false;
try {
  for (let gameIndex = 0; gameIndex < requestedGames; gameIndex += 1) {
    if ((performance.now() - campaignStarted) / 1000 >= timeCapSeconds) {
      globalTimeExpired = true;
      break;
    }
    const seed = baseSeed + gameIndex;
    Math.random = randomFor(seed);
    const gameStarted = performance.now();
    let state = createGame(DIFFICULTIES.map((difficulty, index) => ({
      name: difficulty,
      kind: "ai",
      startingMarket: "europe", // Replaced below from the engine's five canonical zones.
      pawn: PAWNS[index],
      difficulty,
    })) as SeatConfig[]);
    const markets = rotateMarkets(state.zones.map((zone) => zone.id), gameIndex) as ZoneId[];
    state.players.forEach((player, index) => {
      player.startingMarket = markets[index]!;
      player.zone = markets[index]!;
      player.currentMarket = markets[index]!;
    });
    applyEconomicCatalog(state);

    const individualTurns: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    const firstPurchases: Record<string, FirstPurchases> = Object.fromEntries(state.players.map((player) => [player.id, { any: null, small: null, medium: null, large: null }]));
    const post10Turns: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    const post10Purchases: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    const post10NoPurchaseStreak: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    const maxPost10NoPurchaseStreak: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
    const affordabilityGroups = new Map<string, { marketChecks: number; candidateCompanies: number; currentRawAffordableCompanies: number; currentReserveAffordableCompanies: number; anyRawAffordableCompanies: number; anyReserveAffordableCompanies: number }>();
    const checkedMarketTurns = new Set<string>();
    let bankruptcies = 0;
    const bankruptCompanyIds = new Set<string>();
    const firstCheckpoints: Record<string, ReturnType<typeof snapshot>> = {};
    let gameError: string | null = null;
    let step = 0;
    try {
      while (!state.finished) {
        if (step >= 20000) throw new Error("Command limit of 20000 reached.");
        if ((performance.now() - campaignStarted) / 1000 >= timeCapSeconds) {
          globalTimeExpired = true;
          throw new Error("Global wall-time cap reached; this game is partial.");
        }
        step += 1;
        const previous = state;
        const playerId = getDecisionPlayerId(state);
        const player = state.players.find((item) => item.id === playerId);
        if (!player) throw new Error("Decision player not found.");
        const command = chooseAiCommand(state, player.difficulty);
        const individualTurn = (individualTurns[player.id] ?? 0) + 1;

        if (state.phase === "market") {
          const marketKey = `${state.cycle}:${player.id}`;
          if (!checkedMarketTurns.has(marketKey)) {
            checkedMarketTurns.add(marketKey);
            const reserve = reserveFor(player.difficulty);
            const zoneSectorGroups = new Map<string, Company[]>();
            for (const company of state.companies) {
              const key = `${company.zone}|${company.sector}`;
              zoneSectorGroups.set(key, [...(zoneSectorGroups.get(key) ?? []), company]);
            }
            for (const [zoneSector, companies] of zoneSectorGroups) {
              const [zone, sector] = zoneSector.split("|");
              const key = `${player.difficulty ?? "unknown"}|${player.startingMarket}|${zone}|${sector}`;
              const group = affordabilityGroups.get(key) ?? { marketChecks: 0, candidateCompanies: 0, currentRawAffordableCompanies: 0, currentReserveAffordableCompanies: 0, anyRawAffordableCompanies: 0, anyReserveAffordableCompanies: 0 };
              group.marketChecks += 1;
              for (const company of companies) {
                if (!company.available || shareCount(company) >= 5 || (state.zoneGrades[company.zone] === "E" && state.sectorGrades[company.sector] === "E")) continue;
                group.candidateCompanies += 1;
                const price = priceFor(company, state);
                const travelCost = company.zone === player.zone ? 0 : 1;
                const rawAffordable = price <= player.cash - travelCost;
                const reserveAffordable = price <= player.cash - reserve - travelCost;
                const current = company.zone === player.zone;
                if (current && rawAffordable) group.currentRawAffordableCompanies += 1;
                if (current && reserveAffordable) group.currentReserveAffordableCompanies += 1;
                if (rawAffordable) group.anyRawAffordableCompanies += 1;
                if (reserveAffordable) group.anyReserveAffordableCompanies += 1;
              }
              affordabilityGroups.set(key, group);
            }
          }
        }

        const next = executeCommand(state, player.id, command);
        commands += 1;
        next.marketHistory = next.marketHistory.slice(-HISTORY_RETENTION);
        for (const company of previous.companies) {
          const after = next.companies.find((item) => item.id === company.id);
          if (company.available && after && !after.available) {
            bankruptcies += 1;
            bankruptCompanyIds.add(company.id);
          }
        }
        if (command.type === "BUY_SHARE") {
          const bought = next.companies.find((company) => company.id === command.companyId);
          if (!bought) throw new Error(`Bought company ${command.companyId} disappeared.`);
          const category = categoryOf(bought);
          const moment = { cycle: previous.cycle, individualTurn, companyId: bought.id };
          const first = firstPurchases[player.id]!;
          first.any ??= moment;
          if (category !== "unknown") first[category] ??= moment;
          if (previous.cycle > 10) {
            post10Purchases[player.id] = (post10Purchases[player.id] ?? 0) + 1;
            post10NoPurchaseStreak[player.id] = 0;
          }
        }
        if (command.type === "NEXT_TURN") {
          individualTurns[player.id] = (individualTurns[player.id] ?? 0) + 1;
          if (previous.cycle > 10) {
            post10Turns[player.id] = (post10Turns[player.id] ?? 0) + 1;
            const streak = (post10NoPurchaseStreak[player.id] ?? 0) + 1;
            post10NoPurchaseStreak[player.id] = streak;
            maxPost10NoPurchaseStreak[player.id] = Math.max(maxPost10NoPurchaseStreak[player.id] ?? 0, streak);
          }
        }
        for (const targetCycle of CHECKPOINT_CYCLES) {
          const nextCompleted = [...(previous.completedPlayers ?? [])];
          if (command.type === "NEXT_TURN" && !nextCompleted.includes(player.id)) nextCompleted.push(player.id);
          const solventIds = previous.players.filter((item) => item.solvent).map((item) => item.id);
          const closedCycle = previous.cycle === targetCycle && solventIds.every((id) => nextCompleted.includes(id));
          if (closedCycle && !firstCheckpoints[String(targetCycle)]) firstCheckpoints[String(targetCycle)] = snapshot(previous);
        }
        state = next;
      }
    } catch (error) {
      gameError = String(error);
      failures.push({ game: gameIndex + 1, seed, cycle: state.cycle, phase: state.phase, error: gameError, partial: !state.finished });
    }

    const purchasedCategoriesByPlayer: Record<string, Record<Category, number>> = {};
    const portfolioStatsByPlayer: Record<string, Record<Category, { companies: number; shares: number }>> = {};
    for (const player of state.players) {
      purchasedCategoriesByPlayer[player.id] = { small: 0, medium: 0, large: 0, unknown: 0 };
      portfolioStatsByPlayer[player.id] = { small: { companies: 0, shares: 0 }, medium: { companies: 0, shares: 0 }, large: { companies: 0, shares: 0 }, unknown: { companies: 0, shares: 0 } };
      for (const company of state.companies) {
        const category = categoryOf(company);
        const quantity = Number(company.holdings?.[player.id] ?? 0);
        if (quantity > 0) {
          purchasedCategoriesByPlayer[player.id]![category] += 1;
          portfolioStatsByPlayer[player.id]![category].companies += 1;
          portfolioStatsByPlayer[player.id]![category].shares += quantity;
        }
      }
    }
    const playerResults = state.players.map((player) => ({
      id: player.id,
      difficulty: player.difficulty,
      startingMarket: player.startingMarket,
      solvent: player.solvent,
      turns: individualTurns[player.id] ?? 0,
      firstPurchases: firstPurchases[player.id],
      neverPurchased: firstPurchases[player.id]?.any === null,
      neverPurchasedByCategory: Object.fromEntries(([
        ["small", firstPurchases[player.id]?.small],
        ["medium", firstPurchases[player.id]?.medium],
        ["large", firstPurchases[player.id]?.large],
      ] as const).map(([category, purchase]) => [category, purchase === null])),
      postCycle10: {
        ownTurns: post10Turns[player.id] ?? 0,
        purchases: post10Purchases[player.id] ?? 0,
        maxConsecutiveOwnTurnsWithoutPurchase: maxPost10NoPurchaseStreak[player.id] ?? 0,
        noPurchaseThroughEnd: (post10Purchases[player.id] ?? 0) === 0,
        reached100TurnThresholdWithoutPurchase: (maxPost10NoPurchaseStreak[player.id] ?? 0) >= 100,
        rightCensoredAtGameEnd: (maxPost10NoPurchaseStreak[player.id] ?? 0) < 100,
      },
      final: {
        cash: player.cash,
        nav: fundValue(state, player),
        portfolio: portfolioStatsByPlayer[player.id],
      },
    }));
    const serializedGroupRecords = [...affordabilityGroups.entries()].map(([key, value]) => ({ key, ...value }));
    const record = {
      game: gameIndex + 1,
      seed,
      seedHash: hashSeed(seed),
      durationSeconds: (performance.now() - gameStarted) / 1000,
      completed: state.finished,
      partial: !state.finished,
      cycleAtEnd: state.cycle,
      phaseAtEnd: state.phase,
      commands: step,
      error: gameError,
      startingMarkets: Object.fromEntries(state.players.map((player) => [player.difficulty ?? player.id, player.startingMarket])),
      individualTurns,
      firstPurchases: Object.fromEntries(state.players.map((player) => [player.id, firstPurchases[player.id]])),
      checkpointCyclesCaptured: Object.keys(firstCheckpoints).map(Number),
      checkpoints: { ...firstCheckpoints, final: snapshot(state) },
      final: {
        allFunds: snapshot(state).allFunds,
        solventFunds: snapshot(state).solventFunds,
        players: playerResults.map((player) => ({ id: player.id, difficulty: player.difficulty, startingMarket: player.startingMarket, solvent: player.solvent, cash: player.final.cash, nav: player.final.nav })),
      },
      playerResults,
      smallPortfolioAtFinal: portfolioStatsByPlayer,
      bankruptcies,
      distinctCompaniesBankrupted: [...bankruptCompanyIds],
      affordabilityByDifficultyStartZoneSector: serializedGroupRecords,
    };
    if (state.finished) completedRecords.push(record);
    else partialGames.push(record);
    if (globalTimeExpired) break;
    if ((gameIndex + 1) % 5 === 0) console.error(`${outputLabel}: ${gameIndex + 1}/${requestedGames} games reached, ${Math.round((performance.now() - campaignStarted) / 1000)}s`);
  }
} finally {
  Math.random = originalRandom;
}

function combineCheckpoint(records: Record<string, any>[], key: string) {
  const points = records.map((record) => record.checkpoints?.[key]).filter(Boolean);
  const group = (field: "allFunds" | "solventFunds") => {
    const values = points.flatMap((point) => point.players ?? []).filter((player: any) => field === "allFunds" || player.solvent);
    return {
      observations: points.length,
      fundObservations: values.length,
      averageNAV: average(values.map((player: any) => player.nav)),
      averageCash: average(values.map((player: any) => player.cash)),
      averageSmallCompaniesPerFund: average(values.map((player: any) => player.smallCompanies)),
      averageSmallSharesPerFund: average(values.map((player: any) => player.smallShares)),
    };
  };
  return { cycle: key === "final" ? null : Number(key), allFunds: group("allFunds"), solventFunds: group("solventFunds") };
}
function firstPurchaseSummary(records: Record<string, any>[]) {
  const rows = records.flatMap((record) => record.playerResults.map((player: any) => ({ ...player, game: record.game })));
  const keys = ["any", "small", "medium", "large"] as const;
  return Object.fromEntries(keys.map((key) => {
    const acquisitions = rows.map((row: any) => row.firstPurchases?.[key]).filter(Boolean);
    const uncaptured = rows.length - acquisitions.length;
    return [key, {
      fundsObserved: rows.length,
      purchased: acquisitions.length,
      neverPurchasedOrRightCensored: uncaptured,
      medianCycle: median(acquisitions.map((row: any) => row.cycle)),
      averageCycle: average(acquisitions.map((row: any) => row.cycle)),
      medianIndividualTurn: median(acquisitions.map((row: any) => row.individualTurn)),
      averageIndividualTurn: average(acquisitions.map((row: any) => row.individualTurn)),
      byDifficulty: Object.fromEntries(DIFFICULTIES.map((difficulty) => {
        const subset = rows.filter((row: any) => row.difficulty === difficulty);
        const found = subset.map((row: any) => row.firstPurchases?.[key]).filter(Boolean);
        return [difficulty, { funds: subset.length, purchased: found.length, notObservedByEnd: subset.length - found.length, medianCycle: median(found.map((row: any) => row.cycle)), medianIndividualTurn: median(found.map((row: any) => row.individualTurn)) }];
      })),
    }];
  }));
}
const checkpointSummary = Object.fromEntries([...CHECKPOINT_CYCLES.map(String), "final"].map((key) => [key, combineCheckpoint(completedRecords as any[], key)]));
const finalPlayers = completedRecords.flatMap((record: any) => record.playerResults.map((player: any) => ({ ...player, game: record.game })));
const survivorRows = finalPlayers.filter((player: any) => player.solvent);
const totalBankruptcies = completedRecords.reduce((sum: number, record: any) => sum + record.bankruptcies, 0);
const opportunityGroups = new Map<string, { marketChecks: number; currentRawAffordableCompanies: number; currentReserveAffordableCompanies: number; anyRawAffordableCompanies: number; anyReserveAffordableCompanies: number }>();
for (const record of completedRecords as any[]) for (const row of record.affordabilityByDifficultyStartZoneSector) {
  const current = opportunityGroups.get(row.key) ?? { marketChecks: 0, currentRawAffordableCompanies: 0, currentReserveAffordableCompanies: 0, anyRawAffordableCompanies: 0, anyReserveAffordableCompanies: 0 };
  for (const field of Object.keys(current) as (keyof typeof current)[]) current[field] += Number(row[field] ?? 0);
  opportunityGroups.set(row.key, current);
}
const result = {
  schemaVersion: 1,
  metric: "economic-progression",
  outputLabel,
  sourceCommit,
  requestedGames,
  completedGames: completedRecords.length,
  partialGames: partialGames.length,
  failedGames: failures.length,
  timeCapSeconds,
  globalTimeExpired,
  durationSeconds: (performance.now() - campaignStarted) / 1000,
  commands,
  seedPlan: { algorithm: "mulberry32-compatible randomFor", baseSeed, gameSeeds: Array.from({ length: completedRecords.length }, (_, index) => baseSeed + index), seedHashes: completedRecords.map((record: any) => record.seedHash) },
  marketRotation: { markets: JSON.parse(readFileSync(dataPath, "utf8")).zones.map((zone: { id: string }) => zone.id), policy: "each difficulty receives each of five markets once per five-game block; market offset advances by one per game", assignments: completedRecords.map((record: any) => ({ game: record.game, startingMarkets: record.startingMarkets })) },
  difficultyRotation: { difficulties: DIFFICULTIES, policy: "one easy, normal, and hard AI in every game; fixed seat/pawn per difficulty" },
  historyRetention: HISTORY_RETENTION,
  catalog: {
    activeDataPath: dataPath,
    activeDataSha256: sourceHashes.gameData,
    baselineOverridePath: baselineCatalogPath || null,
    baselineOverrideSha256: sourceHashes.baselineCatalog,
    companyCount: catalogIds.length,
    companyIdsPreserved: true,
    overrideFields: baselineById.size ? ["all static company catalog fields; runtime holdings, cost basis, availability, and per-view aggregates preserved"] : [],
    classification: "active company capCategory; fallback thresholds <40B small, <200B medium, otherwise large",
    openingHistoryRecalculatedAfterOverride: Boolean(baselineById.size),
  },
  sourceHashes,
  sourceHistory: { gitHead: sourceCommit, engineFacadePath, gameCorePath, marketRulesPath },
  method: {
    enginePath: "createGame -> getDecisionPlayerId -> chooseAiCommand -> executeCommand until engine finished",
    noRuleEdits: true,
    individualTurnDefinition: "per-fund count of executed NEXT_TURN commands; first purchase is attributed to the current upcoming personal turn",
    firstPurchaseDefinition: "first BUY_SHARE command per fund, classified by company capCategory at action time",
    checkpointDefinition: "snapshot after the final solvent fund completes the named cycle; captures omitted if game ends earlier",
    smallPortfolioDefinition: "number of small companies with positive holdings and total small-category shares; averages reported for all and solvent funds",
    opportunityDefinition: "at one market-phase check per personal turn, companies available, below 5 total shares, not E/E, affordable for one share; raw cash and difficulty reserve variants, including one-unit travel cost for other zones",
    bankruptcyDefinition: "count of company available true-to-false transitions during completed games",
    waiting100Definition: "100 consecutive personal NEXT_TURNs after cycle 10 without BUY_SHARE; each nonattaining completed-game observation is reported as right-censored at end",
  },
  firstPurchaseSummary: firstPurchaseSummary(completedRecords as any[]),
  waiting100WithoutPurchaseAfterCycle10: {
    thresholdPersonalTurns: 100,
    observations: finalPlayers.length,
    reached: finalPlayers.filter((player: any) => player.postCycle10.reached100TurnThresholdWithoutPurchase).length,
    censoredBeforeThreshold: finalPlayers.filter((player: any) => player.postCycle10.rightCensoredAtGameEnd).length,
    noPurchaseAfterCycle10ThroughEnd: finalPlayers.filter((player: any) => player.postCycle10.noPurchaseThroughEnd).length,
    averagePostCycle10PersonalTurns: average(finalPlayers.map((player: any) => player.postCycle10.ownTurns)),
    rowsByFund: finalPlayers.map((player: any) => ({ game: player.game, id: player.id, difficulty: player.difficulty, startingMarket: player.startingMarket, solvent: player.solvent, ...player.postCycle10 })),
    note: "The active game horizon may end before 100 personal turns after cycle 10; these cases remain censored rather than treated as completed 100-turn waits.",
  },
  affordabilityByDifficultyStartZoneSector: [...opportunityGroups.entries()].map(([key, totals]) => ({ key, ...totals })),
  bankruptcySummary: { companyBankruptcyTransitions: totalBankruptcies, bankruptCompaniesByGame: completedRecords.map((record: any) => ({ game: record.game, count: record.bankruptcies, companyIds: record.distinctCompaniesBankrupted })), insolventFunds: finalPlayers.filter((player: any) => !player.solvent).length },
  finalValue: {
    allFunds: { funds: finalPlayers.length, averageNAV: average(finalPlayers.map((player: any) => player.final.nav)), medianNAV: median(finalPlayers.map((player: any) => player.final.nav)), p95NAV: quantile(finalPlayers.map((player: any) => player.final.nav), 0.95), averageCash: average(finalPlayers.map((player: any) => player.final.cash)) },
    survivors: { funds: survivorRows.length, averageNAV: average(survivorRows.map((player: any) => player.final.nav)), medianNAV: median(survivorRows.map((player: any) => player.final.nav)), p95NAV: quantile(survivorRows.map((player: any) => player.final.nav), 0.95), averageCash: average(survivorRows.map((player: any) => player.final.cash)) },
  },
  checkpoints: checkpointSummary,
  failures,
  partialGameDetails: partialGames,
  records: completedRecords,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, requestedGames, completedGames: result.completedGames, partialGames: result.partialGames, failedGames: result.failedGames, durationSeconds: result.durationSeconds, commands, firstPurchaseSummary: result.firstPurchaseSummary, checkpoints: result.checkpoints, waiting100WithoutPurchaseAfterCycle10: result.waiting100WithoutPurchaseAfterCycle10, finalValue: result.finalValue }, null, 2));
