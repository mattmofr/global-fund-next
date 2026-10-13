import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createGame } from "@global-fund/game-engine";
import type { GameState, SeatConfig } from "@global-fund/shared";

const require = createRequire(import.meta.url);
const core = require("../packages/game-engine/legacy/game.cjs") as {
  applyAction(state: GameState, playerId: string, action: string, payload?: Record<string, unknown>): GameState;
  priceFor(company: any, state: GameState): number;
  fundValue(state: GameState, player: GameState["players"][number]): number;
};
const catalog = require("../packages/game-engine/legacy/data/gameData.json");
const boardEventCards: any[] = require("../packages/game-engine/legacy/boardEventCards.cjs").BOARD_EVENT_CARDS;
const grades = ["A", "B", "C", "D", "E"] as const;
const zones = catalog.zones as { id: string; name: string }[];
const sectors = catalog.sectors as { id: string; name: string }[];
const companyCatalog = catalog.companies as { id: string; zone: string; sector: string; basePrice: number }[];
const board = catalog.board as { kind: string; label: string; sector?: string }[];
const eventPosition = board.findIndex((cell) => cell.kind === "event");
const contextSequences = Number(process.argv[2] ?? 10_000);
const eventSequences = Number(process.argv[3] ?? 1_000);
const baseSeed = Number(process.argv[4] ?? 20261013);
const outputPath = process.argv[5] ?? "docs/card-balance-simulation.json";
const contextsPerSequence = 100;
const eventsPerSequence = 100;
const startingCash = 1_000_000;
const expectedCompanies = 91;
const seats: SeatConfig[] = [
  { name: "Fund A", kind: "local", startingMarket: "americas", pawn: "lion", difficulty: "normal" },
  { name: "Fund B", kind: "local", startingMarket: "europe", pawn: "bull", difficulty: "normal" },
];
const sourcePaths = [
  "packages/game-engine/src/index.ts",
  "packages/game-engine/legacy/game.cjs",
  "packages/game-engine/legacy/marketRules.cjs",
  "packages/game-engine/legacy/deckRules.cjs",
  "packages/game-engine/legacy/boardEventCards.cjs",
  "packages/game-engine/legacy/data/gameData.json",
  "scripts/simulate-card-balance.ts",
];
const hashes = Object.fromEntries(sourcePaths.map((path) => [
  path,
  createHash("sha256").update(readFileSync(path)).digest("hex"),
]));

if (!Number.isInteger(contextSequences) || contextSequences < 1 || contextSequences > 10_000) throw new Error("contextSequences must be an integer from 1 to 10000.");
if (!Number.isInteger(eventSequences) || eventSequences < 1 || eventSequences > 10_000) throw new Error("eventSequences must be an integer from 1 to 10000.");
if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) throw new Error("seed must be a nonnegative safe integer.");
if (eventPosition < 1) throw new Error("The board must contain a reachable event cell.");
if (companyCatalog.length !== expectedCompanies) throw new Error(`Expected ${expectedCompanies} companies; found ${companyCatalog.length}.`);

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
function gradeIndex(value: string) { return grades.indexOf(value as (typeof grades)[number]); }
function increment(record: Record<string, number>, key: string, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}
function emptyGradeCounts() { return Object.fromEntries(grades.map((grade) => [grade, 0])) as Record<string, number>; }
function emptyAxisCounts() { return { zone: emptyGradeCounts(), sector: emptyGradeCounts() }; }
function recordGradeSnapshot(target: ReturnType<typeof emptyAxisCounts>, state: GameState) {
  for (const grade of Object.values(state.zoneGrades)) increment(target.zone, grade);
  for (const grade of Object.values(state.sectorGrades)) increment(target.sector, grade);
}
function standardDeviation(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}
function createSimulation(seed: number) {
  const rng = randomFor(seed);
  Math.random = rng;
  try { return { state: createGame(seats), rng }; }
  finally { Math.random = originalRandom; }
}
const originalRandom = Math.random;
const startedAt = performance.now();
const contextGrades = {
  timepointCounts: Object.fromEntries(Array.from({ length: contextsPerSequence + 1 }, (_, step) => [step, { zone: emptyGradeCounts(), sector: emptyGradeCounts(), observations: 0 }])),
  finalByAxis: { zone: emptyGradeCounts(), sector: emptyGradeCounts() },
  finalByEntity: {
    zone: Object.fromEntries(zones.map((zone) => [zone.id, emptyGradeCounts()])) as Record<string, Record<string, number>>,
    sector: Object.fromEntries(sectors.map((sector) => [sector.id, emptyGradeCounts()])) as Record<string, Record<string, number>>,
  },
  outcomes: { zone: { up: 0, down: 0, stable: 0 }, sector: { up: 0, down: 0, stable: 0 } },
  stepSizes: { zone: {} as Record<string, number>, sector: {} as Record<string, number> },
  volatility: { gradeDispersion: 0, zoneSectorCompanyGap: 0, meanAbsoluteChangePerContext: 0, companiesAtEE: 0, observations: 0 },
};
const contextTotals = {
  sequences: 0, cards: 0, decksConsumed: 0, companyClosuresAtEE: 0, companyReopenings: 0,
  closuresWithSharesPaid: 0, sharesLiquidated: 0, liquidationCashTotal: 0, playersReceivingLiquidation: 0,
  sequencesWithClosure: 0, sequencesWithReopening: 0, sequencesWithLiquidation: 0,
  typeCounts: {} as Record<string, number>,
};
const liquidationByCompany: Record<string, { closures: number; sharesPaid: number; cashPaid: number }> = {};
const contextDeckHashes: string[] = [];

function axisValues(state: GameState) {
  return { zones: Object.values(state.zoneGrades).map(gradeIndex), sectors: Object.values(state.sectorGrades).map(gradeIndex) };
}
function recordVolatility(state: GameState, absoluteChanges: number) {
  const values = axisValues(state);
  const all = [...values.zones, ...values.sectors];
  const companyGaps = state.companies.map((company) => Math.abs(gradeIndex(state.zoneGrades[company.zone] ?? "C") - gradeIndex(state.sectorGrades[company.sector] ?? "C")));
  contextGrades.volatility.gradeDispersion += standardDeviation(all);
  contextGrades.volatility.zoneSectorCompanyGap += companyGaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, companyGaps.length);
  contextGrades.volatility.meanAbsoluteChangePerContext += absoluteChanges / Math.max(1, all.length);
  contextGrades.volatility.companiesAtEE += state.companies.filter((company) => state.zoneGrades[company.zone] === "E" && state.sectorGrades[company.sector] === "E").length;
  contextGrades.volatility.observations += 1;
}

for (let sequence = 0; sequence < contextSequences; sequence += 1) {
  const { state } = createSimulation(baseSeed + sequence);
  if (state.deck.length !== contextsPerSequence) throw new Error(`Context sequence ${sequence}: factory deck size ${state.deck.length}, expected 100.`);
  if (state.companies.length !== expectedCompanies) throw new Error(`Context sequence ${sequence}: company count changed.`);
  const originalDeckIds = state.deck.map((card) => String(card.id));
  if (new Set(originalDeckIds).size !== contextsPerSequence) throw new Error(`Context sequence ${sequence}: duplicate factory deck ID.`);
  contextDeckHashes.push(createHash("sha256").update(originalDeckIds.join(",")).digest("hex"));
  const idsBefore = originalDeckIds.slice();
  for (const player of state.players) player.cash = startingCash;
  for (const company of state.companies) {
    for (const player of state.players) company.holdings[player.id] = 1;
  }
  if (state.companies.some((company) => Object.keys(company.holdings).length !== 2 || Object.values(company.holdings).some((quantity) => quantity !== 1))) {
    throw new Error("Context exposure setup failed: expected one share per player and company.");
  }
  recordGradeSnapshot(contextGrades.timepointCounts[0]!, state);
  let sequenceClosures = 0;
  let sequenceReopenings = 0;
  let sequenceLiquidations = 0;
  for (let step = 1; step <= contextsPerSequence; step += 1) {
    const player = state.players[state.activeIndex]!;
    const card = state.deck[0] as any;
    if (!card) throw new Error(`Context sequence ${sequence}: deck ended before card ${step}.`);
    const beforeAvailable = new Map<string, boolean>(state.companies.map((company) => [company.id, company.available] as const));
    const beforeCash = new Map(state.players.map((item) => [item.id, item.cash]));
    let expectedLiquidationCash = 0;
    const beforeLength = state.deck.length;
    const sequenceNotice = state.noticeSeq;
    state.phase = "awaitNext";
    state.stage = "awaitNext";
    state.completedPlayers = state.players.filter((item) => item.id !== player.id).map((item) => item.id);
    core.applyAction(state, player.id, "nextTurn");
    contextTotals.cards += 1;
    if (Number(state.deck.length) !== beforeLength - 1) throw new Error(`Context sequence ${sequence}, step ${step}: engine did not consume exactly one card.`);
    if (String(state.currentContext?.id) !== String(card.id)) throw new Error(`Context sequence ${sequence}, step ${step}: resolved card is out of factory order.`);
    for (let index = 0; index < state.deck.length; index += 1) {
      if (String(state.deck[index]?.id) !== idsBefore[step + index]) throw new Error(`Context sequence ${sequence}, step ${step}: unconsumed context order changed.`);
    }
    const notice = [...state.notices].reverse().find((item) => item.id > sequenceNotice && item.cardType === "context");
    if (!notice) throw new Error(`Context sequence ${sequence}, step ${step}: no real context notice emitted.`);
    increment(contextTotals.typeCounts, String(card.type ?? "unspecified"));
    const outcomes = notice.gradeOutcomes ?? notice.gradeChanges ?? [];
    let absoluteChange = 0;
    for (const outcome of outcomes) {
      const axis = outcome.scope === "zone" ? "zone" : "sector";
      const before = gradeIndex(outcome.before);
      const after = gradeIndex(outcome.after);
      const change = before - after;
      absoluteChange += Math.abs(change);
      if (change > 0) increment(contextGrades.outcomes[axis], "up");
      else if (change < 0) increment(contextGrades.outcomes[axis], "down");
      else increment(contextGrades.outcomes[axis], "stable");
      increment(contextGrades.stepSizes[axis], String(Math.abs(change)));
    }
    recordVolatility(state, absoluteChange);
    for (const company of state.companies) {
      const wasAvailable = beforeAvailable.get(company.id) !== false;
      const isAvailable = company.available !== false;
      if (wasAvailable && !isAvailable) {
        const isEE = state.zoneGrades[company.zone] === "E" && state.sectorGrades[company.sector] === "E";
        if (!isEE) throw new Error(`Company ${company.id} closed without E/E grades.`);
        const impact = notice.companyImpacts?.find((item) => item.companyId === company.id);
        const shares = (impact?.sharesChanged ?? []).reduce((sum, item) => sum + Math.max(0, item.before - item.after), 0);
          // bankruptCompanies pays titlePrice directly (not the rounded priceFor display value).
          const liquidationCash = shares * Number(company.basePrice) / 5 * 0.5 * 0.5;
          expectedLiquidationCash += liquidationCash;
        contextTotals.companyClosuresAtEE += 1;
        sequenceClosures += 1;
        if (shares > 0) {
          contextTotals.closuresWithSharesPaid += 1;
          contextTotals.sharesLiquidated += shares;
          contextTotals.liquidationCashTotal += liquidationCash;
          sequenceLiquidations += 1;
          const affectedPlayers = new Set((impact?.sharesChanged ?? []).filter((item) => item.before > item.after).map((item) => item.playerId));
          contextTotals.playersReceivingLiquidation += affectedPlayers.size;
          liquidationByCompany[company.id] ??= { closures: 0, sharesPaid: 0, cashPaid: 0 };
          liquidationByCompany[company.id]!.closures += 1;
          liquidationByCompany[company.id]!.sharesPaid += shares;
          liquidationByCompany[company.id]!.cashPaid += liquidationCash;
          for (const playerId of affectedPlayers) {
            const before = beforeCash.get(playerId) ?? 0;
            const after = state.players.find((item) => item.id === playerId)?.cash ?? before;
            if (after <= before) throw new Error(`Liquidation for ${company.id} did not pay holder ${playerId}.`);
          }
        }
      } else if (!wasAvailable && isAvailable) {
        if (state.zoneGrades[company.zone] === "E" && state.sectorGrades[company.sector] === "E") throw new Error(`Company ${company.id} reopened while still E/E.`);
        contextTotals.companyReopenings += 1;
        sequenceReopenings += 1;
      }
    }
    const actualLiquidationCash = state.players.reduce((sum, item) => sum + item.cash - (beforeCash.get(item.id) ?? item.cash), 0);
    if (Math.abs(actualLiquidationCash - expectedLiquidationCash) > 0.001) {
      throw new Error(`Context sequence ${sequence}, step ${step}: liquidation cash mismatch; expected ${expectedLiquidationCash}, observed ${actualLiquidationCash}.`);
    }
    const stepSnapshot = contextGrades.timepointCounts[step]!;
    recordGradeSnapshot(stepSnapshot, state);
    stepSnapshot.observations += 1;
    state.marketHistory = state.marketHistory.slice(-2);
    state.log = state.log.slice(-100);
  }
  if (Number(state.deck.length) !== 0) throw new Error(`Context sequence ${sequence}: expected an exhausted deck.`);
  contextTotals.sequences += 1;
  contextTotals.decksConsumed += 1;
  if (sequenceClosures) contextTotals.sequencesWithClosure += 1;
  if (sequenceReopenings) contextTotals.sequencesWithReopening += 1;
  if (sequenceLiquidations) contextTotals.sequencesWithLiquidation += 1;
  for (const [id, grade] of Object.entries(state.zoneGrades)) {
    increment(contextGrades.finalByAxis.zone, grade);
    increment(contextGrades.finalByEntity.zone[id]!, grade);
  }
  for (const [id, grade] of Object.entries(state.sectorGrades)) {
    increment(contextGrades.finalByAxis.sector, grade);
    increment(contextGrades.finalByEntity.sector[id]!, grade);
  }
  if ((sequence + 1) % 100 === 0) console.error(`Context sequences ${sequence + 1}/${contextSequences}; ${((performance.now() - startedAt) / 1_000).toFixed(1)}s`);
}

const eventTotals = {
  sequences: 0, events: 0, deckRefills: 0, prisonResets: 0,
  targetless: 0, targetsByZone: Object.fromEntries(zones.map((zone) => [zone.id, 0])) as Record<string, number>,
  targetsBySector: Object.fromEntries(sectors.map((sector) => [sector.id, 0])) as Record<string, number>,
  targetCounts: {} as Record<string, number>, repeatedPreviousTarget: 0, repeatedWithinRecentFour: 0,
  localCooldownChecks: 0, localCooldownPasses: 0, eventCashDelta: 0,
  navImpact: { positive: 0, neutral: 0, negative: 0 },
  impactByCatalogCategory: Object.fromEntries(["favorable", "mixed", "unfavorable"].map((category) => [category, {
    draws: 0, positiveNAV: 0, neutralNAV: 0, negativeNAV: 0, cashDelta: 0, activeShareDelta: 0,
  }])) as Record<string, { draws: number; positiveNAV: number; neutralNAV: number; negativeNAV: number; cashDelta: number; activeShareDelta: number }>,
  eventEffects: {} as Record<string, number>, categoryCounts: {} as Record<string, number>,
  reshuffleStateChecks: 0,
};
const targetsByZoneSector: Record<string, number> = {};
const initialEventDeckHashes: string[] = [];
const eventById = new Map(boardEventCards.map((card) => [String(card.id), card]));
const catalogEventIds = boardEventCards.map((card) => String(card.id)).sort();
const eventAssignments: { sequence: number; draw: number; cardId: string; zone: string | null; sector: string | null; targetCompanyId: string | null }[] = [];
const boardCatalogAudit = {
  cards: boardEventCards.length,
  categories: Object.fromEntries(["favorable", "mixed", "unfavorable"].map((category) => [category, boardEventCards.filter((card) => card.balanceCategory === category).length])),
  targetSectorCounts: Object.fromEntries(sectors.map((sector) => [sector.id, boardEventCards.filter((card) => card.targetSector === sector.id).length])),
  targetlessCards: boardEventCards.filter((card) => !card.targetSector).length,
};
const contextGradeTargets = { zone: emptyGradeCounts(), sector: emptyGradeCounts() };
const zoneIdSet = new Set(zones.map((zone) => zone.id));
for (const contextCard of catalog.events as any[]) {
  for (const change of contextCard.changes ?? []) {
    increment(zoneIdSet.has(String(change.id)) ? contextGradeTargets.zone : contextGradeTargets.sector, String(change.grade));
  }
}

for (let sequence = 0; sequence < eventSequences; sequence += 1) {
  const { state, rng } = createSimulation(baseSeed + 1_000_000 + sequence);
  const player = state.players[state.activeIndex]!;
  for (const item of state.players) item.cash = startingCash;
  for (const company of state.companies) {
    company.holdings = {};
    company.holdings[player.id] = 2;
  }
  if (state.companies.some((company) => Object.keys(company.holdings).length !== 1 || company.holdings[player.id] !== 2)) {
    throw new Error("Board-event exposure setup failed: expected two active-player shares per company.");
  }
  if (state.boardEventDeck.length !== boardEventCards.length) throw new Error("Factory event deck length differs from the catalog.");
  const originalDeckOrder = state.boardEventDeck.map((card) => card.id);
  initialEventDeckHashes.push(createHash("sha256").update(originalDeckOrder.join(",")).digest("hex"));
  const contextDeckBefore = state.deck.map((card) => String(card.id));
  const initialGrades = { zones: { ...state.zoneGrades }, sectors: { ...state.sectorGrades } };
  const lastTargets: string[] = [];
  for (let draw = 1; draw <= eventsPerSequence; draw += 1) {
    const activePlayer = state.players[state.activeIndex]!;
    if (activePlayer.jailed) {
      activePlayer.jailed = false;
      activePlayer.prisonStage = 0;
      activePlayer.prisonWait = false;
      activePlayer.zone = activePlayer.previousZone ?? activePlayer.startingMarket;
      activePlayer.previousZone = undefined;
      eventTotals.prisonResets += 1;
    }
    activePlayer.sectorPosition = eventPosition - 1;
    state.phase = "sector";
    state.stage = "sector";
    state.completedPlayers = [];
    const beforeDeckIds = state.boardEventDeck.map((card) => String(card.id));
    const beforeGradeJson = JSON.stringify({ zones: state.zoneGrades, sectors: state.sectorGrades });
    const beforeContextDeck = state.deck.map((card) => String(card.id));
    const beforeAvailableCompanies = state.companies.map((company) => ({ ...company, holdings: { ...company.holdings } }));
    const beforeCashForEvent = state.players.reduce((sum, item) => sum + item.cash, 0);
    const beforeActiveCash = activePlayer.cash;
    const beforeActiveNAV = core.fundValue(state, activePlayer);
    const beforeActiveShares = state.companies.reduce((sum, company) => sum + (company.holdings[activePlayer.id] ?? 0), 0);
    const previousRecent = Array.isArray(state.recentEventTargets) ? state.recentEventTargets.slice(-4) : lastTargets.slice(-4);
    const nextRandom = rng;
    let forcedDie = true;
    Math.random = () => {
      if (forcedDie) { forcedDie = false; return (1 - 0.5) / 6; }
      return nextRandom();
    };
    let notice: any;
    try {
      const seq = state.noticeSeq;
      core.applyAction(state, activePlayer.id, "roll");
      notice = [...state.notices].reverse().find((item) => item.id > seq && item.cardType === "event" && item.source === "board");
    } finally {
      Math.random = originalRandom;
    }
    if (!notice?.cardId) throw new Error(`No real board-event notice on event draw ${sequence}/${draw}.`);
    if (state.deck.map((card) => String(card.id)).join(",") !== beforeContextDeck.join(",")) throw new Error("Board event mutated the context deck/order.");
    if (JSON.stringify({ zones: state.zoneGrades, sectors: state.sectorGrades }) !== beforeGradeJson) throw new Error("Board event mutated zone or sector grades.");
    const actualCatalogPartition = [...state.boardEventDeck, ...state.boardEventDiscard].map((card) => String(card.id)).sort();
    if (actualCatalogPartition.join(",") !== catalogEventIds.join(",")) throw new Error("Board event deck/discard lost, duplicated, or changed a catalog card.");
    eventTotals.reshuffleStateChecks += 1;
    if (beforeDeckIds.length === 0) {
      eventTotals.deckRefills += 1;
      if (state.boardEventDeck.length !== boardEventCards.length - 1 || state.boardEventDiscard.length !== 1) throw new Error("Engine did not reshuffle the exhausted board-event discard as expected.");
    } else {
      const expectedId = beforeDeckIds[0];
      if (String(notice.cardId) !== expectedId) throw new Error(`Factory draw order changed: expected ${expectedId}, got ${notice.cardId}.`);
    }
    const card = eventById.get(String(notice.cardId));
    if (!card) throw new Error(`Unknown board card ${notice.cardId}.`);
    increment(eventTotals.eventEffects, String(card.effect));
    increment(eventTotals.categoryCounts, String(card.balanceCategory));
    const activeAfter = state.players.find((item) => item.id === activePlayer.id)!;
    const navDelta = core.fundValue(state, activeAfter) - beforeActiveNAV;
    const cashDeltaForActive = activeAfter.cash - beforeActiveCash;
    const sharesAfter = state.companies.reduce((sum, company) => sum + (company.holdings[activeAfter.id] ?? 0), 0);
    const activeShareDelta = sharesAfter - beforeActiveShares;
    const impactClass = navDelta > 0.005 ? "positive" : navDelta < -0.005 ? "negative" : "neutral";
    increment(eventTotals.navImpact, impactClass);
    const categoryImpact = eventTotals.impactByCatalogCategory[String(card.balanceCategory)]!;
    categoryImpact.draws += 1;
    categoryImpact[`${impactClass}NAV` as "positiveNAV" | "neutralNAV" | "negativeNAV"] += 1;
    categoryImpact.cashDelta += cashDeltaForActive;
    categoryImpact.activeShareDelta += activeShareDelta;
    eventTotals.events += 1;
    const sector = notice.targetedSector ? String(notice.targetedSector) : null;
    const zone = notice.targetedZone ? String(notice.targetedZone) : null;
    const targetId = notice.targetCompanyId ? String(notice.targetCompanyId) : null;
    if (!targetId) eventTotals.targetless += 1;
    else {
      if (zone) increment(eventTotals.targetsByZone, zone);
      if (sector) increment(eventTotals.targetsBySector, sector);
      if (zone && sector) increment(targetsByZoneSector, `${zone}:${sector}`);
      increment(eventTotals.targetCounts, targetId);
      if (lastTargets.at(-1) === targetId) eventTotals.repeatedPreviousTarget += 1;
      if (lastTargets.slice(-4).includes(targetId)) eventTotals.repeatedWithinRecentFour += 1;
      const poolCandidates = beforeAvailableCompanies.filter((company) => company.available && (!card.targetSector || company.sector === card.targetSector));
      const ownPool = poolCandidates.filter((company) => (company.holdings[activePlayer.id] ?? 0) > 0);
      const heldPool = poolCandidates.filter((company) => Object.values(company.holdings).some((quantity) => quantity > 0));
      const eligiblePool = ownPool.length ? ownPool : heldPool.length ? heldPool : poolCandidates;
      const zonePool = eligiblePool.filter((company) => company.zone === zone);
      const zoneFreshPool = zonePool.filter((company) => !previousRecent.includes(company.id));
      if (zoneFreshPool.length) {
        eventTotals.localCooldownChecks += 1;
        if (zoneFreshPool.some((company) => company.id === targetId)) eventTotals.localCooldownPasses += 1;
        else throw new Error(`Recent target selected although fresh target exists in ${zone} for ${sector ?? "global"}.`);
      }
      lastTargets.push(targetId);
    }
    eventAssignments.push({ sequence, draw, cardId: String(notice.cardId), zone, sector, targetCompanyId: targetId });
    const cashDelta = state.players.reduce((sum, item) => sum + item.cash, 0) - beforeCashForEvent;
    eventTotals.eventCashDelta += cashDelta;
    state.marketHistory = state.marketHistory.slice(-2);
    state.log = state.log.slice(-100);
    if (activePlayer.jailed) {
      // The next draw resets only detention state; count it as a scenario reset below.
    }
  }
  eventTotals.sequences += 1;
  if (state.deck.map((card) => String(card.id)).join(",") !== contextDeckBefore.join(",")) throw new Error("Event sequence changed the context deck.");
  if (JSON.stringify({ zones: state.zoneGrades, sectors: state.sectorGrades }) !== JSON.stringify(initialGrades)) throw new Error("Event sequence changed market grades.");
  if ((sequence + 1) % 100 === 0) console.error(`Event sequences ${sequence + 1}/${eventSequences}; ${((performance.now() - startedAt) / 1_000).toFixed(1)}s`);
}

for (const timepoint of Object.values(contextGrades.timepointCounts)) {
  for (const grade of grades) {
    timepoint.zone[grade] /= contextSequences * zones.length;
    timepoint.sector[grade] /= contextSequences * sectors.length;
  }
  timepoint.observations = contextSequences;
}
const finalDenominator = contextSequences;
for (const grade of grades) {
  contextGrades.finalByAxis.zone[grade] /= finalDenominator * zones.length;
  contextGrades.finalByAxis.sector[grade] /= finalDenominator * sectors.length;
}
for (const entityGrades of Object.values(contextGrades.finalByEntity.zone)) {
  for (const grade of grades) entityGrades[grade] /= finalDenominator;
}
for (const entityGrades of Object.values(contextGrades.finalByEntity.sector)) {
  for (const grade of grades) entityGrades[grade] /= finalDenominator;
}
const contextResult = {
  method: "10,000 (or requested count) independent factory-shuffled decks; each of 100 cards is applied with core.applyAction(nextTurn), invoking real drawContext, bankruptCompanies, marketImpacts, and notices.",
  sequences: contextTotals.sequences,
  contextCardsResolved: contextTotals.cards,
  initialPortfolio: { companies: expectedCompanies, sharesPerCompanyPerPlayer: 1, players: seats.length, totalShares: expectedCompanies * seats.length, cashPerPlayer: startingCash, purpose: "stress exposure only; not representative of a playable fund" },
  factoryShuffleOrderSHA256: { distinctDeckOrders: new Set(contextDeckHashes).size, sample: contextDeckHashes.slice(0, 10) },
  gradeFrequenciesByTimepoint: contextGrades.timepointCounts,
  finalGradeFrequenciesByAxis: contextGrades.finalByAxis,
  finalGradeFrequenciesByEntity: contextGrades.finalByEntity,
  finalMeanGradeByAxis: {
    zone: Object.fromEntries(Object.entries(contextGrades.finalByEntity.zone).map(([id, frequencies]) => [id, grades.reduce((sum, grade) => sum + gradeIndex(grade) * frequencies[grade], 0)])),
    sector: Object.fromEntries(Object.entries(contextGrades.finalByEntity.sector).map(([id, frequencies]) => [id, grades.reduce((sum, grade) => sum + gradeIndex(grade) * frequencies[grade], 0)])),
  },
  finalMeanGradeByAxisAcrossEntities: {
    zone: grades.reduce((sum, grade) => sum + gradeIndex(grade) * contextGrades.finalByAxis.zone[grade], 0),
    sector: grades.reduce((sum, grade) => sum + gradeIndex(grade) * contextGrades.finalByAxis.sector[grade], 0),
  },
  actualGradeOutcomes: contextGrades.outcomes,
  gradeStepSizes: contextGrades.stepSizes,
  volatility: {
    meanCrossSectionalGradeStandardDeviation: contextGrades.volatility.gradeDispersion / contextGrades.volatility.observations,
    meanAbsoluteCompanyZoneSectorGap: contextGrades.volatility.zoneSectorCompanyGap / contextGrades.volatility.observations,
    meanAbsoluteGradeChangePerAxisPerContext: contextGrades.volatility.meanAbsoluteChangePerContext / contextGrades.volatility.observations,
    meanCompaniesAtEEPerContextStep: contextGrades.volatility.companiesAtEE / contextGrades.volatility.observations,
    observations: contextGrades.volatility.observations,
  },
  liquidationAndClosures: {
    ...contextTotals,
    liquidationCashTotal: Number(contextTotals.liquidationCashTotal.toFixed(2)),
    byCompany: liquidationByCompany,
  },
};
const eventResult = {
  method: "Each observation uses core.applyAction(roll) on the first reachable event cell with a controlled die result; only the first Math.random call is overridden, and seeded ordinary random draws choose target zone/company. The engine owns draw, discard, reshuffle, and effect execution.",
  sequences: eventTotals.sequences,
  eventsResolved: eventTotals.events,
  eventsPerSequence,
  exposure: { companies: expectedCompanies, activePlayerSharesPerCompanyAtStart: 2, otherPlayersSharesAtStart: 0, cashPerPlayerAtStart: startingCash, noContextCardsDrawn: true, noMarketShocksOrSectorIncome: true, prisonResets: eventTotals.prisonResets },
  factoryShuffleOrderSHA256: { distinctDeckOrders: new Set(initialEventDeckHashes).size, sample: initialEventDeckHashes.slice(0, 10) },
  deckIntegrity: { catalogCardCount: boardEventCards.length, reshufflesObserved: eventTotals.deckRefills, partitionChecks: eventTotals.reshuffleStateChecks, catalogIdsAndMultiplicityPreserved: true },
  effects: eventTotals.eventEffects,
  categories: eventTotals.categoryCounts,
  targetlessEvents: eventTotals.targetless,
  targetsByZone: eventTotals.targetsByZone,
  targetsBySector: eventTotals.targetsBySector,
  targetCountsByZoneAndSector: targetsByZoneSector,
  targetCompanyOccurrences: eventTotals.targetCounts,
  repeatedTargets: { immediate: eventTotals.repeatedPreviousTarget, withinPreviousFour: eventTotals.repeatedWithinRecentFour, localCooldownChecks: eventTotals.localCooldownChecks, localCooldownPasses: eventTotals.localCooldownPasses, rule: "Cooldown excludes four recent global company IDs only when another eligible candidate exists in the selected zone; selection remains zone-first." },
  activePlayerNAVImpact: eventTotals.navImpact,
  actualImpactByCardBalanceCategory: eventTotals.impactByCatalogCategory,
  aggregateCashDeltaFromScenarioStart: Number(eventTotals.eventCashDelta.toFixed(2)),
  boardEventDeckHashes: hashes["packages/game-engine/legacy/boardEventCards.cjs"],
  sampledAssignments: eventAssignments.slice(0, Math.min(100, eventAssignments.length)),
};
const output = {
  objective: "Measure the current 100-card context deck and 50-card board-event deck through mutable legacy core actions, including actual bankruptcy/liquidation and event targeting.",
  configuration: { contextSequences, contextsPerSequence, totalContextCards: contextTotals.cards, eventSequences, eventsPerSequence, totalBoardEvents: eventTotals.events, seed: baseSeed, rng: "mulberry32-style deterministic generator; factory shuffle draw order retained", outputPath },
  hashes,
  contextCatalog: { count: catalog.events.length, types: Object.fromEntries([...new Set((catalog.events as any[]).map((card: any) => String(card.type)))].map((type) => [type, (catalog.events as any[]).filter((card: any) => String(card.type) === type).length])) },
  contextCatalogGradeTargets: contextGradeTargets,
  boardEventCatalog: boardCatalogAudit,
  contextResults: contextResult,
  boardEventResults: eventResult,
  durationSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
};
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
if (outputPath === "docs/card-balance-simulation.json") {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const gradeHeaders = "| Entité | A | B | C | D | E | Indice moyen (A=0…E=4) |\n|---|---:|---:|---:|---:|---:|---:|";
  const rowsFor = (axis: "zone" | "sector", items: { id: string; name: string }[]) => items.map((item) => {
    const frequencies = contextGrades.finalByEntity[axis][item.id]!;
    const mean = grades.reduce((sum, grade) => sum + gradeIndex(grade) * frequencies[grade], 0);
    return `| ${item.name} (${item.id}) | ${pct(frequencies.A)} | ${pct(frequencies.B)} | ${pct(frequencies.C)} | ${pct(frequencies.D)} | ${pct(frequencies.E)} | ${mean.toFixed(3)} |`;
  }).join("\n");
  const timeRows = [0, 10, 25, 50, 75, 100].map((step) => {
    const point = contextGrades.timepointCounts[step]!;
    return `| ${step} | ${(["zone", "sector"] as const).map((axis) => `${pct(point[axis].A)} / ${pct(point[axis].B)} / ${pct(point[axis].C)} / ${pct(point[axis].D)} / ${pct(point[axis].E)}`).join(" | ")} |`;
  }).join("\n");
  const outcomeRows = (["zone", "sector"] as const).map((axis) => `| ${axis === "zone" ? "Zones" : "Secteurs"} | ${contextGrades.outcomes[axis].up.toLocaleString("fr-FR")} | ${contextGrades.outcomes[axis].down.toLocaleString("fr-FR")} | ${contextGrades.outcomes[axis].stable.toLocaleString("fr-FR")} |`).join("\n");
  const impactRows = (["favorable", "mixed", "unfavorable"] as const).map((category) => {
    const impact = eventTotals.impactByCatalogCategory[category]!;
    return `| ${category} | ${impact.draws.toLocaleString("fr-FR")} | ${impact.positiveNAV.toLocaleString("fr-FR")} | ${impact.neutralNAV.toLocaleString("fr-FR")} | ${impact.negativeNAV.toLocaleString("fr-FR")} | ${impact.cashDelta.toFixed(2)} | ${impact.activeShareDelta.toLocaleString("fr-FR")} |`;
  }).join("\n");
  const matrixRows = zones.map((zone) => `| ${zone.name} | ${sectors.map((sector) => (targetsByZoneSector[`${zone.id}:${sector.id}`] ?? 0).toLocaleString("fr-FR")).join(" | ")} |`).join("\n");
  const report = [
    "# Simulation de l’équilibre des cartes",
    "",
    "Résultats détaillés dans [docs/card-balance-simulation.json](docs/card-balance-simulation.json). Les deux campagnes appellent les actions du moteur mutable CJS; les résolutions ne rejouent pas manuellement les grades.",
    "",
    "## Méthode et exposition contrôlée",
    "",
    `- Contextes : ${contextTotals.sequences.toLocaleString("fr-FR")} decks indépendants de 100 cartes (${contextTotals.cards.toLocaleString("fr-FR")} résolutions), via core.applyAction(state, playerId, nextTurn). L’action appelle drawContext, bankruptCompanies, marketImpacts et produit les notices habituelles. Le shuffle d’usine et son ordre sont conservés; chaque deck est consommé dans son ordre initial.`,
    `- Portefeuille Context expérimental : ${expectedCompanies} sociétés, une action détenue par chacun des ${seats.length} fonds, ${seats.length * expectedCompanies} actions au total; ${startingCash.toLocaleString("fr-FR")} M€ de liquidités par fonds. Ce portefeuille dense et les liquidités élevées isolent les effets de fermeture/liquidation; ils ne représentent pas une partie normale.`,
    `- Événements de plateau : ${eventTotals.sequences.toLocaleString("fr-FR")} scénarios de ${eventsPerSequence} lancers réels (${eventTotals.events.toLocaleString("fr-FR")} événements), avec deux actions de chaque société détenues par le fonds actif, aucune action chez les autres fonds et les mêmes liquidités élevées. Le premier appel RNG fournit un dé de 1 pour atteindre une case événement; les appels suivants, le choix zone/société et les remélanges suivent le flux pseudo-aléatoire seedé. Les effets font évoluer le portefeuille entre tirages.`,
    "- Aucun achat, revenu de secteur ni choc de marché n’intervient. Les lancers atterrissent sur une case événement. Les mises à jour Context n’interviennent pas pendant la campagne événements; les grades et l’ordre du deck Context sont contrôlés après chaque événement.",
    `- Les séquences événements comptent les remises en prison et réinitialisent seulement la détention et la zone de départ avant le tirage suivant. À 100 tirages pour un deck de 50 cartes, chaque séquence consomme le deck initial puis effectue un remélange exact. Le script vérifie à chaque tirage que deck + défausse contiennent une fois chaque ID du catalogue et que l’ordre courant est respecté avant épuisement.`,
    "",
    "## Fréquences finales par entité",
    "",
    "Indice moyen : A=0, B=1, C=2, D=3, E=4. Les colonnes A à E donnent la part des séquences où l’entité termine avec cette note.",
    "",
    gradeHeaders,
    rowsFor("zone", zones),
    rowsFor("sector", sectors),
    "",
    `Moyenne de l’indice final sur les entités : zones **${contextResult.finalMeanGradeByAxisAcrossEntities.zone.toFixed(3)}**, secteurs **${contextResult.finalMeanGradeByAxisAcrossEntities.sector.toFixed(3)}**.`,
    "",
    "## Évolution temporelle des notes",
    "",
    "Fréquences en pourcentage A / B / C / D / E, agrégées sur toutes les séquences et les entités de l’axe.",
    "",
    "| Cartes appliquées | Zones A/B/C/D/E | Secteurs A/B/C/D/E |",
    "|---:|---|---|",
    timeRows,
    "",
    "## Transitions et dispersion",
    "",
    "| Axe | Progressions | Baisses | Stables |",
    "|---|---:|---:|---:|",
    outcomeRows,
    "",
    `Dispersion transversale moyenne (écart-type des 14 notes) : **${contextResult.volatility.meanCrossSectionalGradeStandardDeviation.toFixed(3)}** niveaux. Écart moyen zone-secteur sur les 91 sociétés : **${contextResult.volatility.meanAbsoluteCompanyZoneSectorGap.toFixed(3)}** niveaux. Déplacement absolu moyen par axe et carte : **${contextResult.volatility.meanAbsoluteGradeChangePerAxisPerContext.toFixed(3)}**. Exposition moyenne à E/E : **${contextResult.volatility.meanCompaniesAtEEPerContextStep.toFixed(3)} sociétés par étape**.`,
    "",
    "## Fermetures, liquidations et retours",
    "",
    `Fermetures E/E : **${contextTotals.companyClosuresAtEE.toLocaleString("fr-FR")}**; fermetures qui ont liquidé des actions détenues : **${contextTotals.closuresWithSharesPaid.toLocaleString("fr-FR")}**; actions liquidées : **${contextTotals.sharesLiquidated.toLocaleString("fr-FR")}**; liquidités effectivement versées : **${contextTotals.liquidationCashTotal.toFixed(2)} M€**; retours après sortie de E/E : **${contextTotals.companyReopenings.toLocaleString("fr-FR")}**.`,
    `Les secteurs ont terminé A=${(contextGrades.finalByAxis.sector.A * 100).toFixed(2)}%, E=${(contextGrades.finalByAxis.sector.E * 100).toFixed(2)}% des observations finales. Le test du catalogue montre les grades effectivement ciblés; la campagne n’invente aucun grade A/E. Si aucun couple secteur E / zone E n’apparaît, les fermetures et paiements E/E restent à zéro par impossibilité d’exposition dans les cartes courantes, et non par simulation d’un portefeuille sans actions.`,
    "",
    "## Événements de plateau : activité, cibles et effets économiques",
    "",
    `Catalogue source : ${boardCatalogAudit.cards} cartes; catégories favorables ${boardCatalogAudit.categories.favorable}, mixtes ${boardCatalogAudit.categories.mixed}, défavorables ${boardCatalogAudit.categories.unfavorable}; ${boardCatalogAudit.targetlessCards} cartes sans secteur cible. Les fréquences observées sur ${eventTotals.events.toLocaleString("fr-FR")} tirages sont ${eventTotals.categoryCounts.favorable} favorables, ${eventTotals.categoryCounts.mixed} mixtes et ${eventTotals.categoryCounts.unfavorable} défavorables. Effets exécutés : ${Object.entries(eventTotals.eventEffects).map(([effect, count]) => `${effect} ${count}`).join(", ")}.`,
    "",
    "| Catégorie du catalogue | Tirages | NAV positive | NAV neutre | NAV négative | Delta cash actif (M€) | Actions actives gagnées/perdues |",
    "|---|---:|---:|---:|---:|---:|---:|",
    impactRows,
    "",
    `Au total, NAV active positive **${eventTotals.navImpact.positive.toLocaleString("fr-FR")}**, neutre **${eventTotals.navImpact.neutral.toLocaleString("fr-FR")}**, négative **${eventTotals.navImpact.negative.toLocaleString("fr-FR")}**; delta cash cumulé de l’exposition active **${eventTotals.eventCashDelta.toFixed(2)} M€**. Le cash seul ne mesure pas la valeur : ventes forcées et rachats peuvent échanger des actions contre des liquidités; le classement NAV compare la valeur du fonds avant/après chaque carte.`,
    "",
    `Remélanges vérifiés : **${eventTotals.deckRefills.toLocaleString("fr-FR")}**; checks de partition : **${eventTotals.reshuffleStateChecks.toLocaleString("fr-FR")}**; détentions réinitialisées après prison : **${eventTotals.prisonResets.toLocaleString("fr-FR")}**. Répétitions de cible immédiates : ${eventTotals.repeatedPreviousTarget}; cibles revenues dans les quatre précédentes : ${eventTotals.repeatedWithinRecentFour}; règle de cooldown vérifiée dans une zone avec alternative fraîche : ${eventTotals.localCooldownPasses}/${eventTotals.localCooldownChecks}. La sélection de zone reste prioritaire; un répétition locale est admise lorsqu’il n’existe pas de cible fraîche dans la zone choisie.`,
    "",
    "| Zone / secteur cible | " + sectors.map((sector) => sector.name).join(" | ") + " |",
    "|---|" + sectors.map(() => "---:").join("|") + "|",
    matrixRows,
    "",
    "## Reproductibilité et limites",
    "",
    `Commande : npx tsx scripts/simulate-card-balance.ts ${contextSequences} ${eventSequences} ${baseSeed}. La graine, les empreintes SHA-256 du moteur, des catalogues et du script, les empreintes des ordres mélangés et les observations sont consignées dans le JSON. Durée totale : ${output.durationSeconds.toFixed(2)} s.`,
    "Les événements sont mesurés dans une exposition contrôlée avec deux actions initiales par société; les effets de carte modifient ensuite les détentions et la détention après prison est remise à zéro entre observations, avec compteur explicite. La campagne Context conserve les changements de grades et les liquidations au fil des 100 cartes. Les résultats décrivent ces scénarios déterministes et ne prédisent pas les résultats d’une partie ordinaire.",
  ].join("\n") + "\n";
  writeFileSync("CARD_BALANCE_REPORT.md", report);
}
console.log(JSON.stringify({ contextSequences: contextTotals.sequences, contextCards: contextTotals.cards, closures: contextTotals.companyClosuresAtEE, liquidationCash: contextTotals.liquidationCashTotal, eventSequences: eventTotals.sequences, boardEvents: eventTotals.events, deckRefills: eventTotals.deckRefills, durationSeconds: output.durationSeconds, outputPath }, null, 2));
