import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import {
  chooseAiCommand,
  createGame,
  executeCommand,
  fundValue,
  getDecisionPlayerId,
} from "@global-fund/game-engine";
import type { GameNotice, GameState, SeatConfig } from "@global-fund/shared";

const require = createRequire(import.meta.url);
const catalog = require("../packages/game-engine/legacy/data/gameData.json");
const boardEventCards: any[] = require("../packages/game-engine/legacy/boardEventCards.cjs").BOARD_EVENT_CARDS;
const zones = catalog.zones as { id: string; name: string }[];
const sectors = catalog.sectors as { id: string; name: string }[];
const grades = ["A", "B", "C", "D", "E"] as const;
const neutralGradeIndex = 2;
const requestedDecks = 2000;
const contextsPerDeck = 100;
const fullGameCount = Number(process.argv[2] ?? 20);
const baseSeed = Number(process.argv[3] ?? 20261013);
const timeCapSeconds = Number(process.argv[4] ?? 600);
const maxCommandsPerGame = 20000;
const outputPath = "docs/board-deck-simulation.json";
if (!Number.isInteger(fullGameCount) || fullGameCount < 1 || fullGameCount > 10000) throw new Error("Le nombre de parties doit être compris entre 1 et 10000.");
if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) throw new Error("La graine doit être un entier positif.");
if (!Number.isFinite(timeCapSeconds) || timeCapSeconds <= 0) throw new Error("La limite de temps doit être positive.");

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

const sourcePaths = [
  "packages/game-engine/src/index.ts",
  "packages/game-engine/legacy/game.cjs",
  "packages/game-engine/legacy/marketRules.cjs",
  "packages/game-engine/legacy/deckRules.cjs",
  "packages/game-engine/legacy/eventStories.cjs",
  "packages/game-engine/legacy/boardEventCards.cjs",
  "packages/game-engine/legacy/data/gameData.json",
];
const hashes = Object.fromEntries(sourcePaths.map((path) => [
  path,
  createHash("sha256").update(readFileSync(path)).digest("hex"),
]));

const originalRandom = Math.random;
const startedAt = performance.now();
const failures: { stage: string; game?: number; cycle?: number; phase?: string; error: string }[] = [];
let commands = 0;

const zoneIds = new Set(zones.map((item) => item.id));
const gradeIndex = (grade: string) => grades.indexOf(grade as (typeof grades)[number]);
const reverseGrade = (grade: string) => grades[4 - gradeIndex(grade)];
const reflectedChangesKey = (changes: any[]) => changes
  .map((change) => `${change.scope}:${change.id}:${reverseGrade(change.grade)}`)
  .sort()
  .join("|");
const changesKey = (changes: any[]) => changes
  .map((change) => `${change.scope}:${change.id}:${change.grade}`)
  .sort()
  .join("|");

function contextModelAudit() {
  const events: any[] = catalog.events;
  const targetGrades: Record<string, number> = Object.fromEntries(grades.map((grade) => [grade, 0]));
  const byAxis: Record<string, { targets: number; grades: Record<string, number>; byId: Record<string, number> }> = {
    zone: { targets: 0, grades: Object.fromEntries(grades.map((grade) => [grade, 0])), byId: {} },
    sector: { targets: 0, grades: Object.fromEntries(grades.map((grade) => [grade, 0])), byId: {} },
  };
  const cardTypes: Record<string, number> = {};
  const mirrorByKey = new Map<string, any[]>();
  for (const event of events) {
    const key = changesKey(event.changes ?? []);
    mirrorByKey.set(key, [...(mirrorByKey.get(key) ?? []), event]);
  }
  const mirrorPairs: { first: string | number; second: string | number }[] = [];
  const handledMirrorKeys = new Set<string>();
  for (const event of events) {
    cardTypes[event.type ?? "unspecified"] = (cardTypes[event.type ?? "unspecified"] ?? 0) + 1;
    for (const change of event.changes ?? []) {
      const axis = zoneIds.has(String(change.id)) ? "zone" : "sector";
      targetGrades[change.grade] = (targetGrades[change.grade] ?? 0) + 1;
      byAxis[axis].targets += 1;
      byAxis[axis].grades[change.grade] += 1;
      byAxis[axis].byId[change.id] = (byAxis[axis].byId[change.id] ?? 0) + 1;
    }
  }
  for (const [key, matchingCards] of mirrorByKey) {
    if (handledMirrorKeys.has(key)) continue;
    const reflectedKey = reflectedChangesKey(matchingCards[0]?.changes ?? []);
    const reflectedCards = mirrorByKey.get(reflectedKey) ?? [];
    handledMirrorKeys.add(key);
    handledMirrorKeys.add(reflectedKey);
    const pairCount = key === reflectedKey
      ? Math.floor(matchingCards.length / 2)
      : Math.min(matchingCards.length, reflectedCards.length);
    for (let index = 0; index < pairCount; index += 1) {
      const first = matchingCards[index];
      const second = key === reflectedKey ? matchingCards[index + pairCount] : reflectedCards[index];
      mirrorPairs.push({ first: first.id, second: second.id });
    }
  }
  return {
    eventCount: events.length,
    totalGradeTargets: Object.values(byAxis).reduce((sum, item) => sum + item.targets, 0),
    cardTypes,
    targetGrades,
    byAxis,
    mirrorPairs: { pairCount: mirrorPairs.length, pairs: mirrorPairs },
  };
}

function newStateAccumulator() {
  const axes = ["zone", "sector", "global"] as const;
  return Object.fromEntries(axes.map((axis) => [axis, {
    entities: 0,
    grades: Object.fromEntries(grades.map((grade) => [grade, 0])) as Record<string, number>,
    signedOffset: 0,
    ab: 0,
    de: 0,
  }])) as Record<(typeof axes)[number], { entities: number; grades: Record<string, number>; signedOffset: number; ab: number; de: number }>;
}

function addGradeSnapshot(acc: ReturnType<typeof newStateAccumulator>, state: Record<string, Record<string, string>>) {
  const values = [
    ["zone", Object.values(state.zone)],
    ["sector", Object.values(state.sector)],
    ["global", [...Object.values(state.zone), ...Object.values(state.sector)]],
  ] as const;
  for (const [axis, gradesNow] of values) {
    for (const grade of gradesNow) {
      acc[axis].entities += 1;
      acc[axis].grades[grade] = (acc[axis].grades[grade] ?? 0) + 1;
      const index = gradeIndex(grade);
      acc[axis].signedOffset += index - neutralGradeIndex;
      if (index < neutralGradeIndex) acc[axis].ab += 1;
      if (index > neutralGradeIndex) acc[axis].de += 1;
    }
  }
}

function summarizeGradeAccumulator(acc: ReturnType<typeof newStateAccumulator>) {
  return Object.fromEntries(Object.entries(acc).map(([axis, value]) => [axis, {
    entities: value.entities,
    gradeCounts: value.grades,
    frequencies: Object.fromEntries(grades.map((grade) => [grade, value.entities ? value.grades[grade] / value.entities : 0])),
    meanGradeOffsetFromC: value.entities ? value.signedOffset / value.entities : 0,
    probabilityAB: value.entities ? value.ab / value.entities : 0,
    probabilityDE: value.entities ? value.de / value.entities : 0,
    probabilityABMinusDE: value.entities ? (value.ab - value.de) / value.entities : 0,
  }]));
}

function runContextOnly() {
  const checkpointAcc = { 10: newStateAccumulator(), 50: newStateAccumulator(), 100: newStateAccumulator() };
  const transitions: any = {
    zone: { up: 0, down: 0, unchanged: 0, steps: {} },
    sector: { up: 0, down: 0, unchanged: 0, steps: {} },
    global: { up: 0, down: 0, unchanged: 0, steps: {} },
  };
  const typeCounts: Record<string, number> = {};
  let mixedDirectionCards = 0;
  let directionReversals = 0;
  let snapshots = 0;

  for (let deckIndex = 0; deckIndex < requestedDecks; deckIndex += 1) {
    if ((performance.now() - startedAt) / 1000 >= timeCapSeconds) throw new Error(`Limite globale de ${timeCapSeconds} secondes atteinte pendant la passe contexte.`);
    Math.random = randomFor(baseSeed + deckIndex);
    const state = createGame(([
      { name: "easy", kind: "ai", startingMarket: "europe", pawn: "lion", difficulty: "easy" },
      { name: "normal", kind: "ai", startingMarket: "americas", pawn: "bull", difficulty: "normal" },
      { name: "hard", kind: "ai", startingMarket: "asia", pawn: "globe", difficulty: "hard" },
    ]) as SeatConfig[]);
    if (state.deck.length !== contextsPerDeck) throw new Error(`Deck ${deckIndex + 1}: ${state.deck.length} context cards, expected ${contextsPerDeck}.`);
    let gradesNow = {
      zone: Object.fromEntries(zones.map((item) => [item.id, "C"])),
      sector: Object.fromEntries(sectors.map((item) => [item.id, "C"])),
    };
    let previousDirection = 0;

    for (let cardIndex = 0; cardIndex < contextsPerDeck; cardIndex += 1) {
      const card = state.deck[cardIndex] as any;
      typeCounts[card.type ?? "unspecified"] = (typeCounts[card.type ?? "unspecified"] ?? 0) + 1;
      let cardUp = false;
      let cardDown = false;
      const cardDirections: number[] = [];
      for (const change of card.changes ?? []) {
        const axis = zoneIds.has(String(change.id)) ? "zone" : "sector";
        const before = gradeIndex(gradesNow[axis][change.id]);
        const after = gradeIndex(change.grade);
        const direction = Math.sign(before - after); // positive is an improvement toward A
        const step = Math.abs(after - before);
        if (direction > 0) { transitions[axis].up += 1; cardUp = true; }
        else if (direction < 0) { transitions[axis].down += 1; cardDown = true; }
        else transitions[axis].unchanged += 1;
        transitions[axis].steps[step] = (transitions[axis].steps[step] ?? 0) + 1;
        cardDirections.push(direction);
        gradesNow[axis][change.id] = change.grade;
      }
      if (cardUp && cardDown) mixedDirectionCards += 1;
      const nonzeroDirections = cardDirections.filter(Boolean);
      if (nonzeroDirections.length > 1 && new Set(nonzeroDirections).size > 1) mixedDirectionCards += 0;
      for (const direction of nonzeroDirections) {
        if (previousDirection && direction !== previousDirection) directionReversals += 1;
        previousDirection = direction;
      }
      if ([10, 50, 100].includes(cardIndex + 1)) {
        const checkpoint = cardIndex + 1 as 10 | 50 | 100;
        addGradeSnapshot(checkpointAcc[checkpoint], gradesNow);
        snapshots += 1;
      }
    }
    if ((deckIndex + 1) % 250 === 0) console.error(`Contextes: ${deckIndex + 1}/${requestedDecks} decks; ${Math.round((performance.now() - startedAt) / 1000)} s.`);
  }

  const checkpoints = Object.fromEntries([10, 50, 100].map((count) => [count, summarizeGradeAccumulator(checkpointAcc[count as 10 | 50 | 100])]));
  const transitionsGlobal = {
    up: transitions.zone.up + transitions.sector.up,
    down: transitions.zone.down + transitions.sector.down,
    unchanged: transitions.zone.unchanged + transitions.sector.unchanged,
    steps: Object.fromEntries([...new Set([...Object.keys(transitions.zone.steps), ...Object.keys(transitions.sector.steps)])].map((step) => [step, (transitions.zone.steps[step] ?? 0) + (transitions.sector.steps[step] ?? 0)])),
  };
  const transitionSummary = { ...transitions, global: transitionsGlobal };
  const final = checkpoints[100] as any;
  const nearDriftChecks = Object.fromEntries(["zone", "sector", "global"].map((axis) => [axis, {
    meanGradeOffsetFromC: final[axis].meanGradeOffsetFromC,
    probabilityABMinusDE: final[axis].probabilityABMinusDE,
    driftWithinPointOne: Math.abs(final[axis].meanGradeOffsetFromC) <= 0.1,
    tailsWithinPointOne: Math.abs(final[axis].probabilityABMinusDE) <= 0.1,
  }]));
  return {
    requestedDecks,
    contextsPerDeck,
    decksCompleted: requestedDecks,
    checkpoints,
    typeCounts,
    actualTransitions: transitionSummary,
    mixedDirectionCards,
    directionReversals,
    snapshotCount: snapshots,
    longRunChecks: nearDriftChecks,
  };
}

function getBoardEventKind(notice: GameNotice) {
  const byId = boardEventCards.find((card) => card.id === notice.cardId);
  return byId?.effect ?? "unknown";
}

function rankMap(values: Record<string, number>, players: GameState["players"], eligible: Set<string>) {
  return Object.fromEntries(players
    .filter((player) => eligible.has(player.id))
    .sort((a, b) => (values[b.id] ?? 0) - (values[a.id] ?? 0) || a.id.localeCompare(b.id))
    .map((player, index) => [player.id, index + 1]));
}

function runFullGames(contextLongRunPass: boolean) {
  const records: Record<string, any>[] = [];
  const totals: any = {
    buys: 0,
    bankruptcies: 0,
    contextsByType: {},
    contextCards: 0,
    contextGradeOutcomes: { up: 0, down: 0, stable: 0 },
    boardMarkets: { bull: 0, bear: 0, crash: 0, unknown: 0 },
    boardEvents: 0,
    boardEventsByCategory: {},
    boardEventsBySector: {},
    boardEventsByZone: {},
    boardEventImpactClass: { positive: 0, negative: 0, neutral: 0 },
    rankingPairFlips: 0,
    insolvencies: 0,
    contextCausedBankruptcies: 0,
    boardEventCausedBankruptcies: 0,
  };
  const eventsByTitle = new Map((catalog.events as any[]).map((card) => [card.title, card]));
  const boardEventsById = new Map(boardEventCards.map((card) => [card.id, card]));

  for (let gameIndex = 0; gameIndex < fullGameCount; gameIndex += 1) {
    if ((performance.now() - startedAt) / 1000 >= timeCapSeconds) break;
    const gameStarted = performance.now();
    const seed = baseSeed + requestedDecks + gameIndex;
    Math.random = randomFor(seed);
    let state = createGame(([
      { name: "easy", kind: "ai", startingMarket: "europe", pawn: "lion", difficulty: "easy" },
      { name: "normal", kind: "ai", startingMarket: "americas", pawn: "bull", difficulty: "normal" },
      { name: "hard", kind: "ai", startingMarket: "asia", pawn: "globe", difficulty: "hard" },
    ]) as SeatConfig[]);
    const gameTotals: any = {
      buys: 0,
      contexts: 0,
      contextsByType: {},
      contextGradeOutcomes: { up: 0, down: 0, stable: 0 },
      boardMarkets: { bull: 0, bear: 0, crash: 0, unknown: 0 },
      boardEvents: 0,
      bankruptcies: 0,
      contextCausedBankruptcies: 0,
      boardEventCausedBankruptcies: 0,
      rankingPairFlips: 0,
      eventImpactClass: { positive: 0, negative: 0, neutral: 0 },
    };
    let gameCommands = 0;
    let error: string | null = null;

    try {
      for (let step = 0; !state.finished; step += 1) {
        if (step >= maxCommandsPerGame) throw new Error(`Limite de ${maxCommandsPerGame} commandes atteinte.`);
        if ((performance.now() - startedAt) / 1000 >= timeCapSeconds) throw new Error(`Limite globale de ${timeCapSeconds} secondes atteinte.`);
        const active = state.players.find((player) => player.id === getDecisionPlayerId(state));
        if (!active) throw new Error("Joueur décisionnaire introuvable.");
        const before = state;
        const noticeSeq = before.noticeSeq;
        const command = chooseAiCommand(before, active.difficulty);
        state = executeCommand(before, active.id, command);
        gameCommands += 1;
        commands += 1;
        state.marketHistory = state.marketHistory.slice(-2);
        if (command.type === "BUY_SHARE") {
          gameTotals.buys += 1;
          totals.buys += 1;
        }

        const newNotices = state.notices.filter((notice) => notice.id > noticeSeq);
        for (const notice of newNotices) {
          const bankruptcies = (notice.companyImpacts ?? []).filter((impact) => impact.bankruptcy).length;
          gameTotals.bankruptcies += bankruptcies;
          totals.bankruptcies += bankruptcies;
          if (notice.cardType === "context") {
            gameTotals.contexts += 1;
            totals.contextCards += 1;
            const card = eventsByTitle.get(notice.title ?? "");
            const type = card?.type ?? "unclassified";
            gameTotals.contextsByType[type] = (gameTotals.contextsByType[type] ?? 0) + 1;
            totals.contextsByType[type] = (totals.contextsByType[type] ?? 0) + 1;
            totals.contextCausedBankruptcies += bankruptcies;
            gameTotals.contextCausedBankruptcies += bankruptcies;
            for (const outcome of notice.gradeOutcomes ?? notice.gradeChanges ?? []) {
              const beforeGrade = gradeIndex(outcome.before);
              const afterGrade = gradeIndex(outcome.after);
              const direction = beforeGrade - afterGrade;
              if (direction > 0) {
                totals.contextGradeOutcomes.up += 1;
                gameTotals.contextGradeOutcomes.up += 1;
              } else if (direction < 0) {
                totals.contextGradeOutcomes.down += 1;
                gameTotals.contextGradeOutcomes.down += 1;
              } else {
                totals.contextGradeOutcomes.stable += 1;
                gameTotals.contextGradeOutcomes.stable += 1;
              }
            }
          } else if (notice.source === "board" && notice.title && /^(Bull Market|Bear Market|Market Crash)$/i.test(notice.title)) {
            const kind = /bull/i.test(notice.title) ? "bull" : /bear/i.test(notice.title) ? "bear" : "crash";
            gameTotals.boardMarkets[kind] += 1;
            totals.boardMarkets[kind] += 1;
          } else if (notice.source === "board" && notice.cardType === "event") {
            const card = boardEventsById.get(notice.cardId ?? "");
            const category = card?.balanceCategory ?? "unclassified";
            gameTotals.boardEvents += 1;
            totals.boardEvents += 1;
            gameTotals.boardEventCausedBankruptcies += bankruptcies;
            totals.boardEventCausedBankruptcies += bankruptcies;
            totals.boardEventsByCategory[category] = (totals.boardEventsByCategory[category] ?? 0) + 1;
            if (notice.targetedSector) totals.boardEventsBySector[notice.targetedSector] = (totals.boardEventsBySector[notice.targetedSector] ?? 0) + 1;
            if (notice.targetedZone) totals.boardEventsByZone[notice.targetedZone] = (totals.boardEventsByZone[notice.targetedZone] ?? 0) + 1;
            const valuationImpact = (notice.playerImpacts ?? []).reduce((sum, item) => sum + item.valuation, 0);
            const impactClass = valuationImpact > 0.005 ? "positive" : valuationImpact < -0.005 ? "negative" : "neutral";
            totals.boardEventImpactClass[impactClass] += 1;
            gameTotals.eventImpactClass[impactClass] += 1;
          }

          if (notice.source === "card" || notice.cardType === "context") {
            const afterNav = Object.fromEntries(state.players.map((item) => [item.id, fundValue(state, item)]));
            const beforeNav = Object.fromEntries(state.players.map((item) => {
              const impact = notice.playerImpacts?.find((row) => row.playerId === item.id);
              return [item.id, (afterNav[item.id] ?? 0) - (impact?.valuation ?? 0)];
            }));
            const eligible = new Set(before.players.filter((item) => item.solvent && state.players.find((current) => current.id === item.id)?.solvent).map((item) => item.id));
            const preRank = rankMap(beforeNav, state.players, eligible);
            const postRank = rankMap(afterNav, state.players, eligible);
            const ids = Object.keys(preRank);
            for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
              const a = ids[i]; const b = ids[j];
              const oldOrder = Math.sign((preRank[a] ?? 0) - (preRank[b] ?? 0));
              const newOrder = Math.sign((postRank[a] ?? 0) - (postRank[b] ?? 0));
              if (oldOrder !== newOrder) {
                gameTotals.rankingPairFlips += 1;
                totals.rankingPairFlips += 1;
              }
            }
          }
        }
      }
    } catch (caught) {
      error = String(caught);
      failures.push({ stage: "fullGames", game: gameIndex + 1, cycle: state.cycle, phase: state.phase, error });
    }

    const surviving = state.players.filter((player) => player.solvent);
    totals.insolvencies += state.players.length - surviving.length;
    const navs = surviving.map((player) => fundValue(state, player)).sort((a, b) => a - b);
    records.push({
      game: gameIndex + 1,
      seed,
      finished: state.finished,
      cycles: state.cycle,
      commands: gameCommands,
      durationSeconds: (performance.now() - gameStarted) / 1000,
      error,
      contextCards: gameTotals.contexts,
      contextsByType: gameTotals.contextsByType,
      contextGradeOutcomes: gameTotals.contextGradeOutcomes,
      buys: gameTotals.buys,
      boardMarkets: gameTotals.boardMarkets,
      boardEvents: gameTotals.boardEvents,
      eventImpactClass: gameTotals.eventImpactClass,
      bankruptcies: gameTotals.bankruptcies,
      contextCausedBankruptcies: gameTotals.contextCausedBankruptcies,
      boardEventCausedBankruptcies: gameTotals.boardEventCausedBankruptcies,
      rankingPairFlips: gameTotals.rankingPairFlips,
      survivingFunds: surviving.length,
      insolventFunds: state.players.length - surviving.length,
      averageSurvivorNAV: navs.length ? navs.reduce((sum, value) => sum + value, 0) / navs.length : null,
      medianSurvivorNAV: navs.length ? navs[Math.floor(navs.length / 2)] : null,
      finalNAV: Object.fromEntries(state.players.map((player) => [player.name, fundValue(state, player)])),
    });
    console.error(`Parties: ${gameIndex + 1}/${fullGameCount} terminée${error ? " avec erreur" : ""}; ${Math.round((performance.now() - startedAt) / 1000)} s.`);
    if (error) break;
  }

  const recorded = records.length;
  const completed = records.filter((record) => record.finished).length;
  const average = (fn: (record: Record<string, any>) => number) => {
    const selected = records.filter((record) => Number.isFinite(fn(record)));
    return selected.length ? selected.reduce((sum, record) => sum + fn(record), 0) / selected.length : null;
  };
  const catalogCardsByCategory: Record<string, number> = {};
  const catalogCardsBySector: Record<string, number> = {};
  for (const card of boardEventCards) {
    catalogCardsByCategory[card.balanceCategory ?? "unclassified"] = (catalogCardsByCategory[card.balanceCategory ?? "unclassified"] ?? 0) + 1;
    if (card.targetSector) catalogCardsBySector[card.targetSector] = (catalogCardsBySector[card.targetSector] ?? 0) + 1;
  }
  const markets = catalog.board.filter((cell: any) => cell.kind === "market");
  const boardAudit = {
    length: catalog.board.length,
    sectorCells: catalog.board.filter((cell: any) => cell.kind === "sector").length,
    marketCells: markets.length,
    eventCells: catalog.board.filter((cell: any) => cell.kind === "event").length,
    markets: markets.map((cell: any, index: number) => ({ label: cell.label, effect: cell.marketEffect ?? null, positionZeroBased: catalog.board.indexOf(cell), positionOneBased: catalog.board.indexOf(cell) + 1 })),
    sectorCellCounts: Object.fromEntries(sectors.map((sector) => [sector.id, catalog.board.filter((cell: any) => cell.kind === "sector" && (cell.sector ?? cell.sectorId) === sector.id).length])),
    boardEventDeck: { cardCount: boardEventCards.length, categoryCounts: catalogCardsByCategory, targetSectorCounts: catalogCardsBySector },
    boardEventTargetSelection: "uniform random choice among eligible zones, then eligible company in that zone; the four most recent global company target IDs are filtered out of the selected zone when at least one nonrecent candidate is available, otherwise selection falls back to that zone’s full pool",
  };
  const gradeTargets = contextModelAudit();
  const checkValues = [
    { name: "contextsExactly100", pass: gradeTargets.eventCount === contextsPerDeck },
    { name: "contextGradeTargetsExactly360", pass: gradeTargets.totalGradeTargets === 360 },
    { name: "gradeTargetDistributionA10B80C180D80E10", pass: JSON.stringify(gradeTargets.targetGrades) === JSON.stringify({ A: 10, B: 80, C: 180, D: 80, E: 10 }) },
    { name: "zoneTargetFrequency36Each", pass: zones.every((zone) => gradeTargets.byAxis.zone.byId[zone.id] === 36) },
    { name: "sectorTargetFrequency20Each", pass: sectors.every((sector) => gradeTargets.byAxis.sector.byId[sector.id] === 20) },
    { name: "mirrorPairs50", pass: gradeTargets.mirrorPairs.pairCount === 50 },
    { name: "boardHasNoCrash", pass: markets.every((cell: any) => (cell.marketEffect ?? cell.label) !== "crash" && cell.label !== "Market Crash") },
    { name: "boardHas39SectorSpacesWith4or5Each", pass: boardAudit.sectorCells === 39 && Object.values(boardAudit.sectorCellCounts).every((count: any) => count === 4 || count === 5) },
    { name: "bearAtCase40Index39", pass: markets.some((cell: any) => cell.label === "Bear Market" && catalog.board.indexOf(cell) === 39) },
    { name: "boardHas10EventSpaces", pass: boardAudit.eventCells === 10 },
    { name: "boardHas50EventCards", pass: boardEventCards.length === 50 },
    { name: "boardEventCategories19_19_12", pass: catalogCardsByCategory.favorable === 19 && catalogCardsByCategory.mixed === 12 && catalogCardsByCategory.unfavorable === 19 },
    { name: "boardEventsFivePerSector", pass: sectors.every((sector) => catalogCardsBySector[sector.id] === 5) },
    { name: "contextLongRunDriftWithinPointOne", pass: contextLongRunPass },
    { name: "allFullGamesFinished", pass: completed === fullGameCount },
    { name: "noMarketCrashObserved", pass: totals.boardMarkets.crash === 0 },
  ];
  return {
    records,
    summary: {
      requestedGames: fullGameCount,
      gamesRecorded: recorded,
      completedGames: completed,
      averageCycles: average((record) => record.cycles),
      averageSeconds: average((record) => record.durationSeconds),
      averageContextCards: average((record) => record.contextCards),
      averageBuys: average((record) => record.buys),
      averageBankruptcies: average((record) => record.bankruptcies),
      averageInsolventFunds: average((record) => record.insolventFunds),
      averageSurvivorNAVPerGame: average((record) => record.averageSurvivorNAV),
      pooledAverageSurvivorNAV: records.reduce((sum, record) => sum + (record.averageSurvivorNAV ?? 0) * record.survivingFunds, 0) /
        Math.max(1, records.reduce((sum, record) => sum + record.survivingFunds, 0)),
      totals,
    },
    boardAudit,
    catalogCardsByCategory,
    catalogCardsBySector,
    checks: checkValues,
  };
}

try {
  const catalogAudit = contextModelAudit();
  const contextOnly = runContextOnly();
  const longRunChecks = contextOnly.longRunChecks as Record<string, { driftWithinPointOne: boolean; tailsWithinPointOne: boolean }>;
  const longRunPass = Object.values(longRunChecks).every((item) => item.driftWithinPointOne && item.tailsWithinPointOne);
  const fullGames = runFullGames(longRunPass);
  const checks = fullGames.checks;
  const output = {
    objective: "Simuler les distributions de contexte et les parties complètes avec les règles de plateau et de cartes courantes.",
    configuration: {
      contextDecks: requestedDecks,
      contextsPerDeck,
      fullGames: fullGameCount,
      seed: baseSeed,
      timeCapSeconds,
      maxCommandsPerGame,
      seatMarkets: ["europe", "americas", "asia"],
      difficulties: ["easy", "normal", "hard"],
      historyRetention: 2,
      contextOnlyMode: "createGame factory followed by replay of each actual card changes vector; prison and regulation effects do not alter player status or holdings in this analysis",
    },
    hashes,
    catalogAudit,
    contextOnly,
    fullGames: {
      ...fullGames.summary,
      boardAudit: fullGames.boardAudit,
      records: fullGames.records,
    },
    checks,
    durationSeconds: (performance.now() - startedAt) / 1000,
    errors: failures,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({
    path: outputPath,
    completedFullGames: fullGames.summary.completedGames,
    requestedFullGames: fullGameCount,
    contextDecks: requestedDecks,
    checks,
    durationSeconds: output.durationSeconds,
    errors: failures,
  }, null, 2));
  if (failures.length || checks.some((check) => !check.pass)) process.exitCode = 1;
} catch (error) {
  failures.push({ stage: "simulation", error: String(error) });
  writeFileSync(outputPath, JSON.stringify({ hashes, configuration: { contextDecks: requestedDecks, fullGames: fullGameCount, seed: baseSeed }, errors: failures }, null, 2) + "\n");
  console.error(String(error));
  process.exitCode = 1;
} finally {
  Math.random = originalRandom;
}
